package models

type Message struct {
	Role        string // The role of the sender (e.g., "user", "system")
	MessageType string // The type of the message
	Content     string // The content of the message
}

type Model interface {

	/*
	 Executes the model with the given messages and returns the response
	*/
	Execute(messages []Message) (string, error)
}
