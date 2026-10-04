# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Testing

Frontend unit and UI component tests are written using Bun's native test runner (`bun:test`) and React server rendering (`react-dom/server`):

```bash
# Run all frontend tests in non-interactive/CI mode
CI=1 bun test src/ < /dev/null

# Run Biome linting and format checking
CI=1 bun run biome check src/components/ < /dev/null
```

### UI Component Test Coverage

- [ChatHeader](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/chat/ChatHeader.test.tsx): Title fallback, ID display, interactive vs non-interactive mode badges.
- [ChatInput](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/chat/ChatInput.test.tsx): Contextual placeholders, thinking spinner, disabled states, submit button validation.
- [ChatMessageItem](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/chat/ChatMessageItem.test.tsx): User 'U' avatar, assistant 'AI' styling, Harness Error alert, delegation to ToolCall and SubAgent.
- [ToolCallMessage](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/chat/ToolCallMessage.test.tsx): Tool headers, arguments formatting, interactive approval banner (Accept/Reject), Approved/Rejected badges, structured results.
- [SubAgentAccordion](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/chat/SubAgentAccordion.test.tsx): Running/Completed/Error statuses, progress outputs, final results, depth indicators, recursive nested subagent rendering.
- [EmptyChatState](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/chat/EmptyChatState.test.tsx): Welcome card, descriptive guidance, new interaction trigger.
- [Sidebar](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/Sidebar.test.tsx): New chat action, interaction list items, active selection highlight, empty state message.
- [Navbar](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/Navbar.test.tsx): Branding, connection status, authenticated user email/name, OAuth sign-in link.
- [ChatView](file:///home/aditya/projects/BYoAI-Deployment-Platform/apps/chat-ui/frontend/src/components/ChatView.test.tsx): Empty selection fallback, global error banner, messages rendering, live execution spinner, input integration.

