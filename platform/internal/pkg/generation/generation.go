package generation

import (
	"github.com/invopop/jsonschema"
	"github.com/openai/openai-go/v2"
	"github.com/openai/openai-go/v2/option"
)

// GenerateSchema reflects T into the JSON Schema sent as an OpenAI
// structured-output response_format. The reflector defaults emit a root
// {"$id", "$ref": "#/$defs/T", "$defs": {...}}, which OpenAI rejects with
// "$ref cannot have keywords {'$id'}", so the type is inlined anonymously.
func GenerateSchema[T any]() *jsonschema.Schema {
	reflector := jsonschema.Reflector{
		AllowAdditionalProperties: false,
		DoNotReference:            true,
		Anonymous:                 true,
	}
	var v T
	schema := reflector.Reflect(v)
	schema.Version = ""
	return schema
}

type GenerationClient struct {
	client openai.Client
}

func NewClient(apiKey string) *GenerationClient {
	return &GenerationClient{
		client: openai.NewClient(option.WithAPIKey(apiKey)),
	}

}
