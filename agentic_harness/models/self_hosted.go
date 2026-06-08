package models

import (
	"context"
	"fmt"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"

	"log/slog"
)

// This model would be hosted using llama.cpp or some other similar framework.
// This API model would use the OpenAI API spec for compatibility and thus
// and thus this is a wrapper around the OpenAI API client that implements the Model interface.
type SelfHostedModel struct {
	ctx    context.Context
	client openai.Client
}

func NewSelfHostedModel(modelBaseUri string) *SelfHostedModel {
	slog.Info("Initializing SelfHostedModel", "baseUri", modelBaseUri)
	return &SelfHostedModel{
		ctx:    context.Background(),
		client: openai.NewClient(option.WithBaseURL(modelBaseUri)),
	}
}

func (m *SelfHostedModel) Execute(messages []Message) (string, error) {

	// Convert our internal Message format to the OpenAI API format
	var apiMessages []openai.ChatCompletionMessageParamUnion
	for _, msg := range messages {
		switch msg.Role {
		case "user":
			slog.InfoContext(m.ctx, "Processing user message", "content", msg.Content)
			apiMessages = append(apiMessages, openai.UserMessage(msg.Content))
		case "system":
			slog.InfoContext(m.ctx, "Processing system message", "content", msg.Content)
			apiMessages = append(apiMessages, openai.DeveloperMessage(msg.Content))
		case "assistant":
			slog.InfoContext(m.ctx, "Processing assistant message", "content", msg.Content)
			apiMessages = append(apiMessages, openai.AssistantMessage(msg.Content))
		default:
			slog.InfoContext(m.ctx, "Processing unknown message role", "role", msg.Role)
			apiMessages = append(apiMessages, openai.UserMessage(msg.Content)) // Default to user message
		}
	}

	// Call the OpenAI API to get a response
	chatCompletion, err := m.client.Chat.Completions.New(m.ctx, openai.ChatCompletionNewParams{
		Messages: apiMessages,
	})
	if err != nil {
		return "", err
	}

	// Log the choices returned by the API for debugging
	for i, choice := range chatCompletion.Choices {
		slog.InfoContext(m.ctx, "Choice", "index", i, "content", choice.Message.Content)
	}

	if len(chatCompletion.Choices) == 0 {
		return "", fmt.Errorf("no choices returned from model")
	}

	slog.InfoContext(m.ctx, "Selected Choice", "content", chatCompletion.Choices[0].Message.Content)
	// Return the content of the first choice from the response
	return chatCompletion.Choices[0].Message.Content, nil
}
