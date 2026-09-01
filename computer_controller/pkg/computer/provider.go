package computer


// TODO: make this configuration based (prob via YAML file or env vars.. later task)
func GetComputerProvider() IComputerProvider {
	// TODO: use GetDockerComputerProvider for docker providers

	return LocalComputerProvider{}
}