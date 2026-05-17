# Design Docs

We first need to understand the agentic lifecycle:

## Agentic Lifecycle

![Agentic Lifecycle](/docs/images/agentic-lifecycle.png)

## Our deployment plan

The architecture for this will be like this:
1. We will have special CRD types for AI models (self hosted ones like Deepseek, Llama, Gemma, GPT-OSS and cloud models like Gemini, Claude, and GPT).
    - Self hosted AI models will require a docker image which contains the model and the type of API that is used and resource limits
    - Cloud models will require environment variables which hold the secrets for the API keys
2. We will have special CRD types for AI Agents. These are the following attributes for AI Agents: 
    1. Tool Access:
        1. Which would either be through computer use (via SSH into a sandboxed pod or via GUI through a GUI client)
            - These pods by default will not have access to anything outside the cluster but this can be overridable
            - One can declare environment variables or mount volumes via K8s secrets for the pod so any credentials required for the work will then be visible
        2. Which would be through the usage of an MCP server with tool permissions and special credentials
            - We can have something where we declare k8s secrets used for this and 
            - MCP servers can be using SSE, Streamable HTTP, and STDIO
                - SSE and Streamable HTTP will provide a URL to the MCP server
                - STDIO? prob passing in an image for an STDIO MCP with the exectuable command and the environment variables and we'll have a sidecar which exposes an SSE or HTTP area
            - We'll also have "auto-approved tools"
        3. Which would be through the usage of OpenAPI client using special credentials
        4. Credentials in either of these can be through Basic Auth, OAuth, mTLS, etc (Egress)
    2. Models: The AI Models which will be used and what preference of usage would be
    3. Skills: The list of skills that the AI Agent
    4. Memory Management: PostgreSQL, DB2, Oracle, Redis, etc
    5. Telemetry via OpenTelemetry
    6. Network policy
    7. Inbound message queue and outbound message queue (for inbound and outbound messages)
3. We will have special CRD types for the "frontend" for this access:
    - One frontend will be using this AI Agent to perform a task using a k8s Job (this handles the cronjob and other event handling)
    - One frontend will be exposing it as a webhook, OpenAPI support, or MCP support
    - One frontend will be a Chat like interface for it and using it
        - This is the only interface where interactions with the agents are enabled where the agent can ask for the user's preference and allow it to approve the use for certain tools, all other ones won't have this enabled
    - Each of these frontends when sending the job to run, will post the "prompt" into the inbound message queue of the AI Agent. Then it'll be listening/awaiting upon the response from the Agent (this would be the completion response, which in the case of the chat based interaction may be a question). Chat based items can queue messages.
4. We will also have a Deployment Manager CRD type which will manage and monitor all AI models, AI Agents, and frontends that exist in the namespace

The admins working on building their AI Agents can either manage it via Kubernetes or through the admin console.