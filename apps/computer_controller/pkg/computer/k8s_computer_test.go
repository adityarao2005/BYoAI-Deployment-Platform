package computer

import (
	"archive/tar"
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	"github.com/adityarao2005/BYoAI-Deployment-Platform/computer_controller/pkg/config"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/rest"
	k8stesting "k8s.io/client-go/testing"
)

func TestKubernetesComputerProviderLifecycle(t *testing.T) {
	clientSet := fake.NewSimpleClientset()

	// Intercept Pod create to immediately mark it as Running & Ready
	clientSet.PrependReactor("create", "pods", func(action k8stesting.Action) (handled bool, ret runtime.Object, err error) {
		createAction := action.(k8stesting.CreateAction)
		pod := createAction.GetObject().(*corev1.Pod)
		pod.Status = corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{
					Name:  "sandbox",
					Ready: true,
				},
			},
		}
		_ = clientSet.Tracker().Create(action.GetResource(), pod, action.GetNamespace())
		return true, pod, nil
	})

	provider, err := GetKubernetesComputerProvider(KubernetesComputerProviderProps{
		Spec: config.KubernetesSpec{
			Namespace:              "test-ns",
			PodReadyTimeoutSeconds: 5,
		},
		ClientSet: clientSet,
	})
	if err != nil {
		t.Fatalf("failed to initialize KubernetesComputerProvider: %v", err)
	}

	ctx := context.Background()

	// 1. Test CreateComputer with NetworkRules and Resource limits
	sessionID, err := provider.CreateComputer(ctx, ComputerConfig{
		Image: "alpine:latest",
		Resources: &ComputerResourceConfig{
			CPU:    "500m",
			Memory: "256Mi",
		},
		Environment: map[string]string{
			"TEST_VAR": "hello",
		},
		NetworkRules: &NetworkRules{
			AllowedHosts: []string{"10.0.0.1", "192.168.1.0/24"},
		},
	})
	if err != nil {
		t.Fatalf("CreateComputer failed: %v", err)
	}
	if sessionID == "" {
		t.Fatal("expected non-empty sessionID")
	}

	// Verify pod was created in test-ns with emptyDir volume
	pods, err := clientSet.CoreV1().Pods("test-ns").List(ctx, metav1.ListOptions{})
	if err != nil || len(pods.Items) != 1 {
		t.Fatalf("expected 1 pod in test-ns, got %d (err: %v)", len(pods.Items), err)
	}
	pod := pods.Items[0]
	if pod.Labels["byoai.ai/session-id"] != sessionID {
		t.Errorf("expected session label %s, got %s", sessionID, pod.Labels["byoai.ai/session-id"])
	}
	if len(pod.Spec.Volumes) == 0 || pod.Spec.Volumes[0].EmptyDir == nil {
		t.Errorf("expected emptyDir volume for ephemeral workspace")
	}

	// Verify NetworkPolicy was created
	netpols, err := clientSet.NetworkingV1().NetworkPolicies("test-ns").List(ctx, metav1.ListOptions{})
	if err != nil || len(netpols.Items) != 1 {
		t.Fatalf("expected 1 NetworkPolicy in test-ns, got %d (err: %v)", len(netpols.Items), err)
	}

	// 2. Test GetComputer
	comp, err := provider.GetComputer(ctx, sessionID)
	if err != nil {
		t.Fatalf("GetComputer failed: %v", err)
	}
	if comp.GetSessionId() != sessionID {
		t.Errorf("expected sessionId %s, got %s", sessionID, comp.GetSessionId())
	}

	// 3. Test DeleteComputer
	err = provider.DeleteComputer(ctx, sessionID)
	if err != nil {
		t.Fatalf("DeleteComputer failed: %v", err)
	}

	// Verify computer is deleted from provider map
	_, err = provider.GetComputer(ctx, sessionID)
	if err == nil {
		t.Fatal("expected error getting deleted computer, got nil")
	}
}

func TestKubernetesComputerStartupPodAdoption(t *testing.T) {
	// Pre-populate clientSet with an existing pod
	existingPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "byoai-comp-existing123",
			Namespace: "test-adopt",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "computer-controller",
				"byoai.ai/session-id":          "existing123",
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	clientSet := fake.NewSimpleClientset(existingPod)

	provider, err := GetKubernetesComputerProvider(KubernetesComputerProviderProps{
		Spec: config.KubernetesSpec{
			Namespace: "test-adopt",
		},
		ClientSet: clientSet,
	})
	if err != nil {
		t.Fatalf("failed to initialize provider: %v", err)
	}

	// Should have adopted existing123
	comp, err := provider.GetComputer(context.Background(), "existing123")
	if err != nil {
		t.Fatalf("expected existing123 to be adopted, got error: %v", err)
	}
	if comp.GetSessionId() != "existing123" {
		t.Errorf("expected sessionId existing123, got %s", comp.GetSessionId())
	}
}

func TestKubernetesComputerDisplayDetection(t *testing.T) {
	graphicalPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "byoai-comp-gui",
			Namespace: "default",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "computer-controller",
				"byoai.ai/session-id":          "gui-session",
			},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{
					Name: "sandbox",
					Env: []corev1.EnvVar{
						{Name: "DISPLAY", Value: ":99"},
					},
				},
			},
		},
	}

	clientSet := fake.NewSimpleClientset(graphicalPod)

	provider, err := GetKubernetesComputerProvider(KubernetesComputerProviderProps{
		Spec: config.KubernetesSpec{
			Namespace: "default",
		},
		ClientSet: clientSet,
	})
	if err != nil {
		t.Fatalf("failed to create provider: %v", err)
	}

	comp, err := provider.GetComputer(context.Background(), "gui-session")
	if err != nil {
		t.Fatalf("GetComputer failed: %v", err)
	}

	guiComp, err := GetGraphicalComputer(comp)
	if err != nil {
		t.Fatalf("expected graphical computer, got error: %v", err)
	}
	if kGui, ok := guiComp.(*KubernetesGraphicalComputer); !ok || kGui.display != ":99" {
		t.Errorf("expected KubernetesGraphicalComputer with display :99")
	}
}

func TestKubernetesComputerExecutionAndFiles(t *testing.T) {
	// Mock file system in pod
	podFiles := make(map[string][]byte)
	podFiles["/workspace/hello.txt"] = []byte("Hello from Kubernetes Sandbox!")

	mockExecFn := func(ctx context.Context, clientSet kubernetes.Interface, restCfg *rest.Config, ns, pod string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) (int, error) {
		cmdStr := strings.Join(cmd, " ")

		if strings.Contains(cmdStr, "echo 'hello world'") {
			if stdout != nil {
				io.WriteString(stdout, "hello world\n")
			}
			return 0, nil
		}

		if strings.Contains(cmdStr, "id -u") {
			if stdout != nil {
				io.WriteString(stdout, "1001\n")
			}
			return 0, nil
		}

		if strings.Contains(cmdStr, "id -g") {
			if stdout != nil {
				io.WriteString(stdout, "1001\n")
			}
			return 0, nil
		}

		// Handle tar cf - <path> (ReadFile or ListDirectory)
		if len(cmd) >= 4 && cmd[0] == "tar" && cmd[1] == "cf" && cmd[2] == "-" {
			path := cmd[3]
			var buf bytes.Buffer
			tw := tar.NewWriter(&buf)

			if content, ok := podFiles[path]; ok {
				_ = tw.WriteHeader(&tar.Header{
					Name: "hello.txt",
					Mode: 0644,
					Size: int64(len(content)),
				})
				_, _ = tw.Write(content)
			} else if path == "/workspace" {
				// List directory
				_ = tw.WriteHeader(&tar.Header{
					Name:     "workspace/",
					Typeflag: tar.TypeDir,
				})
				_ = tw.WriteHeader(&tar.Header{
					Name:     "workspace/hello.txt",
					Typeflag: tar.TypeReg,
					Size:     int64(len(podFiles["/workspace/hello.txt"])),
				})
				_, _ = tw.Write(podFiles["/workspace/hello.txt"])
			}
			_ = tw.Close()

			if stdout != nil {
				io.Copy(stdout, &buf)
			}
			return 0, nil
		}

		// Handle tar xf - -C <dir> (WriteFile)
		if len(cmd) >= 5 && cmd[0] == "tar" && cmd[1] == "xf" && cmd[2] == "-" {
			targetDir := cmd[4]
			if stdin != nil {
				tr := tar.NewReader(stdin)
				for {
					hdr, err := tr.Next()
					if err == io.EOF {
						break
					}
					if err != nil {
						return 1, err
					}
					data, _ := io.ReadAll(tr)
					podFiles[targetDir+"/"+hdr.Name] = data
				}
			}
			return 0, nil
		}

		return 0, nil
	}

	comp := &KubernetesComputer{
		sessionId: "test-exec-session",
		podName:   "byoai-comp-test",
		namespace: "default",
		clientSet: fake.NewSimpleClientset(),
		execFn:    mockExecFn,
	}

	ctx := context.Background()

	// 1. Test Execute
	execRes, err := comp.Execute(ctx, ExecInput{
		Command: "echo 'hello world'",
	})
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}
	if strings.TrimSpace(execRes.Stdout) != "hello world" {
		t.Errorf("expected 'hello world', got %q", execRes.Stdout)
	}

	// 2. Test ExecuteStream
	session, err := comp.ExecuteStream(ctx, ExecInput{
		Command: "echo 'hello world'",
	})
	if err != nil {
		t.Fatalf("ExecuteStream failed: %v", err)
	}
	var streamBuf bytes.Buffer
	go io.Copy(&streamBuf, session.Stdout)
	code, err := session.Wait()
	if err != nil || code != 0 {
		t.Errorf("expected exit code 0, got %d (err: %v)", code, err)
	}

	// 3. Test ReadFile
	fileBytes, err := comp.ReadFile(ctx, "/workspace/hello.txt")
	if err != nil {
		t.Fatalf("ReadFile failed: %v", err)
	}
	if string(fileBytes) != "Hello from Kubernetes Sandbox!" {
		t.Errorf("unexpected content: %s", string(fileBytes))
	}

	// 4. Test WriteFile
	newContent := []byte("Newly written file")
	err = comp.WriteFile(ctx, "/workspace/new.txt", newContent)
	if err != nil {
		t.Fatalf("WriteFile failed: %v", err)
	}
	if string(podFiles["/workspace/new.txt"]) != string(newContent) {
		t.Errorf("WriteFile content mismatch")
	}

	// 5. Test ListDirectory
	items, err := comp.ListDirectory(ctx, "/workspace")
	if err != nil {
		t.Fatalf("ListDirectory failed: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected at least 1 item from ListDirectory")
	}
	if items[0].Name != "hello.txt" {
		t.Errorf("expected item hello.txt, got %s", items[0].Name)
	}

	// 6. Test GetUserId and GetGroupId
	uid, err := comp.GetUserId()
	if err != nil || uid != "1001" {
		t.Errorf("expected uid 1001, got %s (err: %v)", uid, err)
	}
	gid, err := comp.GetGroupId()
	if err != nil || gid != "1001" {
		t.Errorf("expected gid 1001, got %s (err: %v)", gid, err)
	}
}

func TestKubernetesGraphicalComputerActions(t *testing.T) {
	var executedCmds []string
	clipboardContent := "initial-clipboard"

	mockExecFn := func(ctx context.Context, clientSet kubernetes.Interface, restCfg *rest.Config, ns, pod string, cmd []string, stdin io.Reader, stdout, stderr io.Writer) (int, error) {
		cmdStr := strings.Join(cmd, " ")
		executedCmds = append(executedCmds, cmdStr)

		if strings.Contains(cmdStr, "xdotool getdisplaygeometry") {
			if stdout != nil {
				io.WriteString(stdout, "1920 1080\n")
			}
			return 0, nil
		}
		if strings.Contains(cmdStr, "xclip -selection clipboard -o") {
			if stdout != nil {
				io.WriteString(stdout, clipboardContent)
			}
			return 0, nil
		}
		if strings.Contains(cmdStr, "xclip -selection clipboard") && stdin != nil {
			data, _ := io.ReadAll(stdin)
			clipboardContent = string(data)
			return 0, nil
		}
		if strings.Contains(cmdStr, "maim -u") {
			if stdout != nil {
				// Fake PNG header
				io.WriteString(stdout, "\x89PNG\r\n\x1a\nfake-screenshot-data")
			}
			return 0, nil
		}

		return 0, nil
	}

	guiComp := &KubernetesGraphicalComputer{
		KubernetesComputer: &KubernetesComputer{
			sessionId: "gui-test-session",
			podName:   "byoai-comp-gui",
			namespace: "default",
			clientSet: fake.NewSimpleClientset(),
			execFn:    mockExecFn,
		},
		display: ":1",
	}

	ctx := context.Background()

	// 1. Click
	if err := guiComp.Click(ctx, 100, 200, "left"); err != nil {
		t.Fatalf("Click failed: %v", err)
	}

	// 2. Type
	if err := guiComp.Type(ctx, "hello AI"); err != nil {
		t.Fatalf("Type failed: %v", err)
	}

	// 3. MoveMouseTo & Drag
	if err := guiComp.MoveMouseTo(ctx, 50, 75); err != nil {
		t.Fatalf("MoveMouseTo failed: %v", err)
	}
	if err := guiComp.Drag(ctx, 10, 10, 20, 20); err != nil {
		t.Fatalf("Drag failed: %v", err)
	}

	// 4. Key actions
	if err := guiComp.PressKey(ctx, "Return"); err != nil {
		t.Fatalf("PressKey failed: %v", err)
	}
	if err := guiComp.ReleaseKey(ctx, "Return"); err != nil {
		t.Fatalf("ReleaseKey failed: %v", err)
	}
	if err := guiComp.ReleaseAllKeys(ctx); err != nil {
		t.Fatalf("ReleaseAllKeys failed: %v", err)
	}

	// 5. Scroll
	if err := guiComp.Scroll(ctx, 2, -3); err != nil {
		t.Fatalf("Scroll failed: %v", err)
	}

	// 6. Clipboard
	clip, err := guiComp.GetClipboard(ctx)
	if err != nil || clip != "initial-clipboard" {
		t.Fatalf("GetClipboard failed: %v, got %q", err, clip)
	}
	if err := guiComp.SetClipboard(ctx, "new-clipboard"); err != nil {
		t.Fatalf("SetClipboard failed: %v", err)
	}

	// 7. Screen size
	w, h, err := guiComp.GetScreenSize(ctx)
	if err != nil || w != 1920 || h != 1080 {
		t.Fatalf("GetScreenSize failed: %v, got %dx%d", err, w, h)
	}

	// 8. CaptureScreenshot
	img, err := guiComp.CaptureScreenshot(ctx)
	if err != nil || !strings.Contains(string(img), "PNG") {
		t.Fatalf("CaptureScreenshot failed: %v, len: %d", err, len(img))
	}
}
