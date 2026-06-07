package models

type Message struct {
	role        string // The role of the sender (e.g., "user", "system")
	messageType string // The type of the message
	content     string // The content of the message
}

type Model interface {

	/*
	 Executes the model with the given messages and returns the response
	*/
	Execute(messages []Message) string
}
