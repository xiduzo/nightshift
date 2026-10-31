# 5. A Model Profile has an address

Status: accepted, 2026-10-31

## Context

A Decision or a Value made by a model reads a Model Profile: a decider and
a model. Only the Ollama decider can reach a server that the person runs.
Its address is one setting per Device (`ollamaAddress`). The TypeSafe and
OpenAI deciders always call the vendor's API, although their packages take
a base URL.

People now run decision models themselves. OpenJev serves the Jev wire API
(`/v1/systemone`), the OpenAI Decisions API (`/v1/decisions`) and chat
(`/v1/chat/completions`). It runs small encoders on a CPU and DiffusionGemma
through MLX on a Mac. LM Studio, llama-server, mlx-lm and vLLM serve
OpenAI-compatible chat. Night Shift reaches none of them.

The flows on the author's computers have no Decision or Value made by a
model ([node review](../research/node-review-2026-10.md) §2.2). A model
that costs nothing and runs next to the Host makes them worth using.

## Decision

1. **A Model Profile can have an address.** The address is a base URL, an
   optional API key (a secret by name) and optional headers (with
   `${NAME}` secrets). Unset: the decider's own default.
2. **The address belongs to the profile, so it belongs to one Device**
   ([ADR 3](0003-a-profile-belongs-to-one-device.md)). A profile on the
   Host names an address that the Host reaches, for example a container
   on its network. A profile on a Mac names `127.0.0.1`.
3. **Two new deciders.**
   - `openjev`: the Jev wire API at an address. It answers choice, score
     and yes/no questions with a probability. It needs an address. Its
     API key is optional. It is priced free.
   - `compatible`: any OpenAI-compatible chat server at an address. It
     makes a Value, and it decides without a probability, as the Ollama
     decider does. It is priced free.
4. **The `openai` and `ollama` deciders take the address too.** For
   `openai`, it replaces the vendor URL (an OpenJev `/v1/decisions`, for
   example). For `ollama`, it wins over the Device's `ollamaAddress`.
   TypeSafe and OpenRouter stay vendor APIs.
5. **A profile lists the models of its address.** The editor asks the
   address for `/v1/models` (Ollama: its tags), the same as the Ollama
   model list today.
6. **A run checks the address when it starts.** It asks each address that
   a node of the flow names. An address that does not answer stops the run
   before its first step, with the profile and the address in the message.
7. **Agent Profiles do not change.** An Agent runs a coding-agent CLI with
   its own login and its own provider settings. A local model for an Agent
   is a harness setting, for example OpenCode with `ollama/<model>`.

## Consequences

- OpenJev on the Host and OpenJev on a Mac are two profiles. A node picks
  the one it needs, and placement follows the profile's Device.
- The `ollamaAddress` Device setting stays. It is the default for the
  `ollama` decider and the address of the knowledge embeddings.
- A decider without a probability (`compatible`, `ollama`) cannot take part
  in a confidence test ([ADR 6](0006-a-cascade-climbs-tiers.md)).
- The secrets of an address stay on the profile's Device, as all secrets
  do ([ADR 1](0001-one-personal-space-per-home-host.md)).
