export function setupUnitTest(): void {
    // Go's helper marks unit tests as parallel; Vitest already schedules them concurrently.
}

export function setupIntegrationTest(): void {
}

export function getSelfHostedModelBaseUri(): string {
    return process.env.SELF_HOSTED_MODEL_BASE_URI ?? 'http://localhost:8000/v1'
}
