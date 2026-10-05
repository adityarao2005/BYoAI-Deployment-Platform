package computer

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/logger"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	utilwait "k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"
	utilexec "k8s.io/client-go/util/exec"
)

type k8sSessionState struct {
	podName           string
	networkPolicyName string
}

type KubernetesComputerProvider struct {
	mu        sync.RWMutex
	apiClient kubernetes.Interface
	restCfg   *rest.Config
	namespace string
	spec      config.KubernetesSpec
	computers map[string]k8sSessionState

	// Optional exec factory hook for testing/mocking
	execFn K8sExecFunction
}

type KubernetesComputerProviderProps struct {
	Spec      config.KubernetesSpec
	ClientSet kubernetes.Interface
	RestCfg   *rest.Config
	ExecFn    K8sExecFunction
}

// resolveK8sNamespace determines the target namespace according to priority:
// 1. spec.Namespace
// 2. POD_NAMESPACE env var
// 3. /var/run/secrets/kubernetes.io/serviceaccount/namespace (in-cluster SA)
// 4. "default"
func resolveK8sNamespace(specNamespace string) string {
	if specNamespace != "" {
		return specNamespace
	}
	if podNs := os.Getenv("POD_NAMESPACE"); podNs != "" {
		return podNs
	}
	if nsBytes, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
		ns := strings.TrimSpace(string(nsBytes))
		if ns != "" {
			return ns
		}
	}
	return "default"
}

// buildK8sClient constructs the rest.Config and kubernetes.Interface using dual-mode
// detection: explicit kubeconfig path -> in-cluster SA token -> default ~/.kube/config.
func buildK8sClient(spec config.KubernetesSpec) (*rest.Config, kubernetes.Interface, error) {
	var restCfg *rest.Config
	var err error

	if spec.Kubeconfig != "" {
		restCfg, err = clientcmd.BuildConfigFromFlags("", os.ExpandEnv(spec.Kubeconfig))
	} else {
		// 1. Try In-Cluster Config (pod deployment)
		restCfg, err = rest.InClusterConfig()
		if errors.Is(err, rest.ErrNotInCluster) {
			// 2. Out-of-cluster fallback (~/.kube/config or KUBECONFIG env var)
			loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
			configOverrides := &clientcmd.ConfigOverrides{}
			if spec.Context != "" {
				configOverrides.CurrentContext = spec.Context
			}
			kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)
			restCfg, err = kubeConfig.ClientConfig()
		}
	}

	if err != nil {
		return nil, nil, fmt.Errorf("failed to build kubernetes client configuration: %w", err)
	}

	clientSet, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create kubernetes clientset: %w", err)
	}

	return restCfg, clientSet, nil
}

// GetKubernetesComputerProvider initializes the provider and adopts running pods.
func GetKubernetesComputerProvider(props KubernetesComputerProviderProps) (*KubernetesComputerProvider, error) {
	namespace := resolveK8sNamespace(props.Spec.Namespace)

	var restCfg *rest.Config
	var apiClient kubernetes.Interface

	if props.ClientSet != nil {
		apiClient = props.ClientSet
		restCfg = props.RestCfg
	} else {
		var err error
		restCfg, apiClient, err = buildK8sClient(props.Spec)
		if err != nil {
			return nil, err
		}
	}

	provider := &KubernetesComputerProvider{
		apiClient: apiClient,
		restCfg:   restCfg,
		namespace: namespace,
		spec:      props.Spec,
		computers: make(map[string]k8sSessionState),
		execFn:    props.ExecFn,
	}

	// Adopt active computer pods labeled with app.kubernetes.io/managed-by=computer-controller
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	podList, err := apiClient.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/managed-by=computer-controller",
	})
	if err == nil {
		for _, pod := range podList.Items {
			if sid, ok := pod.Labels["byoai.ai/session-id"]; ok && sid != "" {
				provider.computers[sid] = k8sSessionState{
					podName:           pod.Name,
					networkPolicyName: fmt.Sprintf("byoai-netpol-%s", sid),
				}
				logger.Info("Adopted existing computer sandbox pod", "sessionID", sid, "podName", pod.Name)
			}
		}
	}

	return provider, nil
}

func buildK8sEnv(env map[string]string) []corev1.EnvVar {
	var envs []corev1.EnvVar
	for k, v := range env {
		envs = append(envs, corev1.EnvVar{
			Name:  k,
			Value: v,
		})
	}
	return envs
}

func buildK8sResources(res *ComputerResourceConfig) corev1.ResourceRequirements {
	reqs := corev1.ResourceRequirements{
		Limits:   make(corev1.ResourceList),
		Requests: make(corev1.ResourceList),
	}
	if res == nil {
		return reqs
	}

	if res.CPU != "" {
		if q, err := resource.ParseQuantity(res.CPU); err == nil {
			reqs.Limits[corev1.ResourceCPU] = q
			reqs.Requests[corev1.ResourceCPU] = q
		}
	}
	if res.Memory != "" {
		if q, err := resource.ParseQuantity(res.Memory); err == nil {
			reqs.Limits[corev1.ResourceMemory] = q
			reqs.Requests[corev1.ResourceMemory] = q
		}
	}
	return reqs
}

func generateSessionID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func (provider *KubernetesComputerProvider) CreateComputer(ctx context.Context, config ComputerConfig) (string, error) {
	sessionID := generateSessionID()
	podName := fmt.Sprintf("byoai-comp-%s", sessionID)

	envs := buildK8sEnv(config.Environment)
	resReqs := buildK8sResources(config.Resources)

	labels := map[string]string{
		"app.kubernetes.io/name":       "byoai-computer",
		"app.kubernetes.io/managed-by": "computer-controller",
		"byoai.ai/session-id":          sessionID,
	}
	for k, v := range provider.spec.Labels {
		labels[k] = v
	}

	annotations := make(map[string]string)
	for k, v := range provider.spec.Annotations {
		annotations[k] = v
	}

	pullPolicy := corev1.PullIfNotPresent
	if provider.spec.ImagePullPolicy != "" {
		pullPolicy = corev1.PullPolicy(provider.spec.ImagePullPolicy)
	}

	// 1. Create native NetworkPolicy if network rules are specified
	var networkPolicyName string
	if config.NetworkRules != nil && (len(config.NetworkRules.AllowedHosts) > 0 || len(config.NetworkRules.DeniedHosts) > 0) {
		networkPolicyName = fmt.Sprintf("byoai-netpol-%s", sessionID)
		netPol := &networkingv1.NetworkPolicy{
			ObjectMeta: metav1.ObjectMeta{
				Name:      networkPolicyName,
				Namespace: provider.namespace,
				Labels:    labels,
			},
			Spec: networkingv1.NetworkPolicySpec{
				PodSelector: metav1.LabelSelector{
					MatchLabels: map[string]string{
						"byoai.ai/session-id": sessionID,
					},
				},
				PolicyTypes: []networkingv1.PolicyType{networkingv1.PolicyTypeEgress},
				Egress:      buildNetworkPolicyEgress(config.NetworkRules),
			},
		}
		_, err := provider.apiClient.NetworkingV1().NetworkPolicies(provider.namespace).Create(ctx, netPol, metav1.CreateOptions{})
		if err != nil {
			return "", fmt.Errorf("failed to create network policy %s: %w", networkPolicyName, err)
		}
	}

	// 2. Define Sandbox Pod
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:        podName,
			Namespace:   provider.namespace,
			Labels:      labels,
			Annotations: annotations,
		},
		Spec: corev1.PodSpec{
			RestartPolicy:      corev1.RestartPolicyNever,
			ServiceAccountName: provider.spec.ServiceAccountName,
			NodeSelector:       provider.spec.NodeSelector,
			Containers: []corev1.Container{
				{
					Name:            "sandbox",
					Image:           config.Image,
					ImagePullPolicy: pullPolicy,
					Command:         []string{"sleep", "infinity"},
					Stdin:           true,
					StdinOnce:       false,
					TTY:             false,
					Env:             envs,
					Resources:       resReqs,
					VolumeMounts: []corev1.VolumeMount{
						{
							Name:      "workspace-volume",
							MountPath: "/workspace",
						},
					},
				},
			},
			Volumes: []corev1.Volume{
				{
					Name: "workspace-volume",
					VolumeSource: corev1.VolumeSource{
						EmptyDir: &corev1.EmptyDirVolumeSource{},
					},
				},
			},
		},
	}

	createdPod, err := provider.apiClient.CoreV1().Pods(provider.namespace).Create(ctx, pod, metav1.CreateOptions{})
	if err != nil {
		if networkPolicyName != "" {
			_ = provider.apiClient.NetworkingV1().NetworkPolicies(provider.namespace).Delete(context.Background(), networkPolicyName, metav1.DeleteOptions{})
		}
		return "", fmt.Errorf("failed to create pod %s: %w", podName, err)
	}

	// 3. Wait for Pod to become Running and container ready
	readyTimeout := time.Duration(provider.spec.PodReadyTimeoutSeconds) * time.Second
	if readyTimeout <= 0 {
		readyTimeout = 60 * time.Second
	}

	waitCtx, cancel := context.WithTimeout(ctx, readyTimeout)
	defer cancel()

	err = utilwait.PollUntilContextCancel(waitCtx, 500*time.Millisecond, true, func(ctx context.Context) (bool, error) {
		p, getErr := provider.apiClient.CoreV1().Pods(provider.namespace).Get(ctx, createdPod.Name, metav1.GetOptions{})
		if getErr != nil {
			return false, getErr
		}
		if p.Status.Phase == corev1.PodRunning {
			for _, cs := range p.Status.ContainerStatuses {
				if cs.Name == "sandbox" && cs.Ready {
					return true, nil
				}
			}
		}
		if p.Status.Phase == corev1.PodFailed {
			return false, fmt.Errorf("pod %s entered Failed phase: %s", p.Name, p.Status.Message)
		}
		return false, nil
	})

	if err != nil {
		// Cleanup pod and netpol on timeout/failure
		_ = provider.apiClient.CoreV1().Pods(provider.namespace).Delete(context.Background(), createdPod.Name, metav1.DeleteOptions{})
		if networkPolicyName != "" {
			_ = provider.apiClient.NetworkingV1().NetworkPolicies(provider.namespace).Delete(context.Background(), networkPolicyName, metav1.DeleteOptions{})
		}
		return "", fmt.Errorf("pod %s failed to reach Ready status: %w", createdPod.Name, err)
	}

	provider.mu.Lock()
	provider.computers[sessionID] = k8sSessionState{
		podName:           createdPod.Name,
		networkPolicyName: networkPolicyName,
	}
	provider.mu.Unlock()

	return sessionID, nil
}

func buildNetworkPolicyEgress(rules *NetworkRules) []networkingv1.NetworkPolicyEgressRule {
	var egressRules []networkingv1.NetworkPolicyEgressRule

	// Always allow DNS (port 53 UDP & TCP)
	udpProtocol := corev1.ProtocolUDP
	tcpProtocol := corev1.ProtocolTCP
	dnsPort := intstr.FromInt32(53)
	egressRules = append(egressRules, networkingv1.NetworkPolicyEgressRule{
		Ports: []networkingv1.NetworkPolicyPort{
			{Protocol: &udpProtocol, Port: &dnsPort},
			{Protocol: &tcpProtocol, Port: &dnsPort},
		},
	})

	if rules == nil || len(rules.AllowedHosts) == 0 {
		return egressRules
	}

	for _, host := range rules.AllowedHosts {
		// If CIDR or IP
		if _, _, err := net.ParseCIDR(host); err == nil {
			egressRules = append(egressRules, networkingv1.NetworkPolicyEgressRule{
				To: []networkingv1.NetworkPolicyPeer{
					{IPBlock: &networkingv1.IPBlock{CIDR: host}},
				},
			})
			continue
		}
		if ip := net.ParseIP(host); ip != nil {
			cidr := host + "/32"
			if ip.To4() == nil {
				cidr = host + "/128"
			}
			egressRules = append(egressRules, networkingv1.NetworkPolicyEgressRule{
				To: []networkingv1.NetworkPolicyPeer{
					{IPBlock: &networkingv1.IPBlock{CIDR: cidr}},
				},
			})
			continue
		}
		// If hostname, attempt resolution
		if ips, err := net.LookupIP(host); err == nil {
			for _, ip := range ips {
				cidr := ip.String() + "/32"
				if ip.To4() == nil {
					cidr = ip.String() + "/128"
				}
				egressRules = append(egressRules, networkingv1.NetworkPolicyEgressRule{
					To: []networkingv1.NetworkPolicyPeer{
						{IPBlock: &networkingv1.IPBlock{CIDR: cidr}},
					},
				})
			}
		}
	}

	return egressRules
}

func (provider *KubernetesComputerProvider) GetComputer(ctx context.Context, sessionId string) (IComputer, error) {
	provider.mu.RLock()
	state, exists := provider.computers[sessionId]
	provider.mu.RUnlock()

	if !exists {
		// Fallback check against K8s API by label
		podList, err := provider.apiClient.CoreV1().Pods(provider.namespace).List(ctx, metav1.ListOptions{
			LabelSelector: fmt.Sprintf("byoai.ai/session-id=%s", sessionId),
		})
		if err == nil && len(podList.Items) > 0 {
			state = k8sSessionState{
				podName:           podList.Items[0].Name,
				networkPolicyName: fmt.Sprintf("byoai-netpol-%s", sessionId),
			}
			provider.mu.Lock()
			provider.computers[sessionId] = state
			provider.mu.Unlock()
			exists = true
		}
	}

	if !exists {
		return nil, fmt.Errorf("computer not found for sessionId %s", sessionId)
	}

	baseComp := &KubernetesComputer{
		sessionId: sessionId,
		podName:   state.podName,
		namespace: provider.namespace,
		clientSet: provider.apiClient,
		restCfg:   provider.restCfg,
		execFn:    provider.execFn,
	}

	if display, ok := detectPodDisplay(ctx, provider.apiClient, provider.namespace, state.podName); ok {
		return &KubernetesGraphicalComputer{
			KubernetesComputer: baseComp,
			display:            display,
		}, nil
	}

	return baseComp, nil
}

func (provider *KubernetesComputerProvider) DeleteComputer(ctx context.Context, sessionId string) error {
	provider.mu.Lock()
	state, exists := provider.computers[sessionId]
	if exists {
		delete(provider.computers, sessionId)
	}
	provider.mu.Unlock()

	if !exists {
		return nil
	}

	// Delete pod in background
	deletePolicy := metav1.DeletePropagationBackground
	_ = provider.apiClient.CoreV1().Pods(provider.namespace).Delete(ctx, state.podName, metav1.DeleteOptions{
		PropagationPolicy: &deletePolicy,
	})

	// Delete network policy if one was created
	if state.networkPolicyName != "" {
		_ = provider.apiClient.NetworkingV1().NetworkPolicies(provider.namespace).Delete(ctx, state.networkPolicyName, metav1.DeleteOptions{})
	}

	return nil
}

// -----------------------------------------------------------------------------
// KubernetesComputer Implementation (IComputer)
// -----------------------------------------------------------------------------

type K8sExecFunction func(ctx context.Context, clientSet kubernetes.Interface, restCfg *rest.Config, namespace, podName string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) (int, error)

type KubernetesComputer struct {
	sessionId string
	podName   string
	namespace string
	clientSet kubernetes.Interface
	restCfg   *rest.Config
	execFn    K8sExecFunction

	userOnce  sync.Once
	cachedUID string
	cachedGID string
}

func (c *KubernetesComputer) GetSessionId() string {
	return c.sessionId
}

// defaultK8sExec performs remotecommand SPDY exec against a running Pod container.
func defaultK8sExec(ctx context.Context, clientSet kubernetes.Interface, restCfg *rest.Config, namespace, podName string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) (int, error) {
	req := clientSet.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: "sandbox",
			Command:   cmd,
			Stdin:     stdin != nil,
			Stdout:    stdout != nil,
			Stderr:    stderr != nil,
			TTY:       false,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(restCfg, "POST", req.URL())
	if err != nil {
		return -1, fmt.Errorf("failed to create SPDY executor: %w", err)
	}

	streamErr := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  stdin,
		Stdout: stdout,
		Stderr: stderr,
	})

	if streamErr != nil {
		if exitErr, ok := streamErr.(utilexec.ExitError); ok {
			return exitErr.ExitStatus(), nil
		}
		return -1, streamErr
	}

	return 0, nil
}

func (c *KubernetesComputer) executeCommand(ctx context.Context, cmd []string, stdin io.Reader, stdout, stderr io.Writer) (int, error) {
	if c.execFn != nil {
		return c.execFn(ctx, c.clientSet, c.restCfg, c.namespace, c.podName, cmd, stdin, stdout, stderr)
	}
	return defaultK8sExec(ctx, c.clientSet, c.restCfg, c.namespace, c.podName, cmd, stdin, stdout, stderr)
}

func buildShellCommand(execInput ExecInput) []string {
	if execInput.Shell != nil && *execInput.Shell == "" {
		return []string{execInput.Command}
	}

	shell := "sh"
	if execInput.Shell != nil {
		shell = *execInput.Shell
	}

	var script strings.Builder
	if execInput.Cwd != nil && *execInput.Cwd != "" {
		script.WriteString(fmt.Sprintf("cd %q && ", *execInput.Cwd))
	}
	if len(execInput.Env) > 0 {
		for _, e := range execInput.Env {
			script.WriteString(fmt.Sprintf("export %s=%q; ", e.Name, e.Value))
		}
	}
	script.WriteString(execInput.Command)

	var args []string
	if execInput.ShellArgs != nil {
		args = append(args, execInput.ShellArgs...)
	} else {
		args = append(args, "-c")
	}
	args = append(args, script.String())

	return append([]string{shell}, args...)
}

func (c *KubernetesComputer) Execute(ctx context.Context, execInput ExecInput) (*ExecResult, error) {
	cmd := buildShellCommand(execInput)

	var stdin io.Reader
	if execInput.Stdin != nil {
		stdin = strings.NewReader(*execInput.Stdin)
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	exitCode, err := c.executeCommand(ctx, cmd, stdin, &stdoutBuf, &stderrBuf)
	if err != nil {
		return nil, fmt.Errorf("remote exec failed: %w", err)
	}

	return &ExecResult{
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		ExitCode: exitCode,
	}, nil
}

func (c *KubernetesComputer) ExecuteStream(ctx context.Context, execInput ExecInput) (*ExecStreamSession, error) {
	cmd := buildShellCommand(execInput)

	stdinPipeReader, stdinPipeWriter := io.Pipe()
	stdoutPipeReader, stdoutPipeWriter := io.Pipe()
	stderrPipeReader, stderrPipeWriter := io.Pipe()

	errChan := make(chan error, 1)
	exitCodeChan := make(chan int, 1)

	streamCtx, cancel := context.WithCancel(ctx)

	go func() {
		defer stdoutPipeWriter.Close()
		defer stderrPipeWriter.Close()
		defer stdinPipeReader.Close()

		exitCode, err := c.executeCommand(streamCtx, cmd, stdinPipeReader, stdoutPipeWriter, stderrPipeWriter)
		if err != nil {
			errChan <- err
			return
		}
		exitCodeChan <- exitCode
	}()

	return &ExecStreamSession{
		Stdin:  stdinPipeWriter,
		Stdout: stdoutPipeReader,
		Stderr: stderrPipeReader,
		Wait: func() (int, error) {
			select {
			case <-ctx.Done():
				cancel()
				return -1, ctx.Err()
			case err := <-errChan:
				return -1, err
			case code := <-exitCodeChan:
				return code, nil
			}
		},
		Kill: func() error {
			cancel()
			_ = stdinPipeWriter.Close()
			return nil
		},
	}, nil
}

func (c *KubernetesComputer) ReadFile(ctx context.Context, filePath string) ([]byte, error) {
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd := []string{"tar", "cf", "-", filePath}

	exitCode, err := c.executeCommand(ctx, cmd, nil, &stdoutBuf, &stderrBuf)
	if err != nil {
		return nil, fmt.Errorf("failed to copy file out of pod: %w", err)
	}
	if exitCode != 0 {
		return nil, fmt.Errorf("tar failed with exit code %d: %s", exitCode, stderrBuf.String())
	}

	tr := tar.NewReader(&stdoutBuf)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read tar stream: %w", err)
		}
		if header.Typeflag == tar.TypeDir {
			continue
		}
		return io.ReadAll(tr)
	}

	return nil, fmt.Errorf("file not found in tar stream: %s", filePath)
}

func (c *KubernetesComputer) WriteFile(ctx context.Context, filePath string, content []byte) error {
	var tarBuf bytes.Buffer
	tw := tar.NewWriter(&tarBuf)

	header := &tar.Header{
		Name: filepath.Base(filePath),
		Mode: 0644,
		Size: int64(len(content)),
	}
	if err := tw.WriteHeader(header); err != nil {
		return fmt.Errorf("failed to write tar header: %w", err)
	}
	if _, err := tw.Write(content); err != nil {
		return fmt.Errorf("failed to write tar content: %w", err)
	}
	if err := tw.Close(); err != nil {
		return fmt.Errorf("failed to close tar writer: %w", err)
	}

	targetDir := filepath.Dir(filePath)
	mkdirCmd := []string{"mkdir", "-p", targetDir}
	_, _ = c.executeCommand(ctx, mkdirCmd, nil, nil, nil)

	var stderrBuf bytes.Buffer
	cmd := []string{"tar", "xf", "-", "-C", targetDir}
	exitCode, err := c.executeCommand(ctx, cmd, &tarBuf, nil, &stderrBuf)
	if err != nil {
		return fmt.Errorf("failed to write file to pod: %w", err)
	}
	if exitCode != 0 {
		return fmt.Errorf("tar failed with exit code %d: %s", exitCode, stderrBuf.String())
	}

	return nil
}

func (c *KubernetesComputer) ListDirectory(ctx context.Context, dirPath string) ([]FileInfo, error) {
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd := []string{"tar", "cf", "-", dirPath}

	exitCode, err := c.executeCommand(ctx, cmd, nil, &stdoutBuf, &stderrBuf)
	if err != nil {
		return nil, fmt.Errorf("failed to list directory in pod: %w", err)
	}
	if exitCode != 0 {
		return nil, fmt.Errorf("tar failed with exit code %d: %s", exitCode, stderrBuf.String())
	}

	tr := tar.NewReader(&stdoutBuf)
	baseName := filepath.Base(dirPath)
	var fileInfos []FileInfo

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to parse tar header: %w", err)
		}

		name := strings.TrimSuffix(header.Name, "/")
		if name == baseName || name == "." {
			continue
		}

		relPath := strings.TrimPrefix(name, baseName+"/")
		if strings.Contains(relPath, "/") {
			continue
		}

		isDir := header.Typeflag == tar.TypeDir
		var size int64
		if !isDir {
			size = header.Size
		}

		fileInfos = append(fileInfos, FileInfo{
			Name:  filepath.Base(relPath),
			IsDir: isDir,
			Size:  size,
		})
	}

	return fileInfos, nil
}

func (c *KubernetesComputer) GetUserId() (string, error) {
	c.ensureUserCached()
	return c.cachedUID, nil
}

func (c *KubernetesComputer) GetGroupId() (string, error) {
	c.ensureUserCached()
	return c.cachedGID, nil
}

func (c *KubernetesComputer) ensureUserCached() {
	c.userOnce.Do(func() {
		c.cachedUID = "0"
		c.cachedGID = "0"

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		var stdout bytes.Buffer
		cmd := []string{"id", "-u"}
		if code, err := c.executeCommand(ctx, cmd, nil, &stdout, nil); err == nil && code == 0 {
			c.cachedUID = strings.TrimSpace(stdout.String())
		}

		stdout.Reset()
		cmd = []string{"id", "-g"}
		if code, err := c.executeCommand(ctx, cmd, nil, &stdout, nil); err == nil && code == 0 {
			c.cachedGID = strings.TrimSpace(stdout.String())
		}
	})
}
