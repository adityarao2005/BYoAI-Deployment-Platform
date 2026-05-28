package main

import (
	"context"

	"github.com/openai/openai-go/v3" // imported as openai
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

const MODEL_BASE_URL = "http://localhost:8080/"

func main() {
	context := context.Background()

	client := openai.NewClient(
		option.WithBaseURL(MODEL_BASE_URL),
	)

	question := "Write me a haiku about computers"

	resp, err := client.Responses.New(context, responses.ResponseNewParams{
		Input: responses.ResponseNewParamsInputUnion{OfString: openai.String(question)},
	})

	if err != nil {
		panic(err)
	}

	println(resp.OutputText())
}
