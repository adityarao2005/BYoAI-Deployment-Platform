package models

type Message struct {
	Role        Role   // The role of the sender (e.g., "user", "system", "assistant")
	MessageType string // The type of the message
	Content     string // The content of the message
}

type Role string

const (
	User      Role = "user"
	System    Role = "system"
	Assistant Role = "assistant"
)

type Model interface {

	/*
	 Executes the model with the given messages and returns the response
	*/
	Execute(messages []Message) (string, error)
}
