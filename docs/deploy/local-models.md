# A model on your own server

A Decision or a Value decided by a model reads a Model Profile. The
profile can name an address: the server that its decider asks. Use it to
point a profile at a model that you run yourself, for example
[OpenJev](https://github.com/razorback16/openjev) in a container next to
the Host, or on a Mac. A model on your own server costs nothing per call.

The decision is recorded in
[ADR 5](../adr/0005-a-model-profile-has-an-address.md).

## Which decider takes an address

| Decider | What it asks at the address | Address | Makes a Value | Probability |
| --- | --- | --- | --- | --- |
| `openjev` | The Jev wire API, `/v1/systemone` | Required | No | Yes |
| `compatible` | OpenAI-compatible chat, `/v1/chat/completions` (LM Studio, llama-server, mlx-lm, vLLM) | Required | Yes | No |
| `openai` | OpenAI's Decisions API, `/v1/decisions` (OpenJev answers it too) | Optional: replaces OpenAI's API | Yes | Yes |
| `ollama` | Ollama's API | Optional: replaces the Ollama address setting | Yes | No |

TypeSafe, OpenRouter and Ollaya always use their own service. A profile on
them takes no address. `openjev` and `compatible` cost nothing. A decider
without a probability can only pick. It cannot tell how sure it is.

## The address

- **Base URL**: the server, for example `http://127.0.0.1:8080`. A
  trailing `/v1` is fine too.
- **API key secret**: optional. The name of a secret that holds the key,
  for example `OPENJEV_API_KEY`. Night Shift sends it as
  `Authorization: Bearer <key>`. With an address, the `openai` decider
  sends this key only, never `OPENAI_API_KEY`.
- **Headers**: optional. A value reads a secret as `${NAME}`, for example
  `X-Api-Key: ${PROXY_KEY}`.

A profile belongs to one computer
([ADR 3](../adr/0003-a-profile-belongs-to-one-device.md),
[ADR 19](../adr/0019-a-profile-means-its-device.md)). The steps that use it
run there. So that computer must reach the address. A step reads the key
from the Space's or the project's secrets, or from that computer's own
(**This computer**) secrets. A Personal secret does not work on a Host. A
flow names the profile, never the address.

## Check the address

1. Open the Agents page, then **Model profiles**.
2. Add a profile, or open one, and choose its decider.
3. Enter the base URL, and the API key secret if the server needs a key.
4. Click **Test address**. Night Shift asks the server for its models.
   It shows the models, or why the server did not answer.
5. Pick a model, then save the profile.

When a run starts, Night Shift asks each address that a node of the flow
names again. If a server does not answer, the run does not start. The
message names the profile, the address and the nodes, for example:

```text
The profile jev uses the address http://openjev:8080 (triage). Nothing
answers there. Start the server, or change the address on the Agents page.
```

Night Shift does not ask a computer that is offline. A node can list
**Backups**: other profiles, on other computers. The first backup that can
take the step runs it. A node without backups waits for its computer.

## OpenJev on the Host network

The small encoder models of OpenJev (`laya-1.0`, `verdict-1.4`) run on the
CPU. Run one in a container on the same network as the Host.

1. Add a service to the compose file of the Host. Use the image of the
   model that you want. For Laya:

   ```yaml
   services:
     openjev:
       image: razorback16/openjev-laya:0.7.0
       restart: unless-stopped
       environment:
         OPENJEV_DEVICE: cpu
         # Optional: require a key.
         # OPENJEV_API_KEY: ${OPENJEV_API_KEY}
       volumes:
         - huggingface:/root/.cache/huggingface
       # No ports: only containers on this network reach it.

   volumes:
     huggingface:
   ```

2. Start it: `docker compose up -d openjev`. The first start downloads the
   weights into the volume.
3. If you set `OPENJEV_API_KEY`, save the same key in Night Shift, for
   example as `OPENJEV_API_KEY`. Save it as **This computer** on the Host's
   Secrets page, or on the **Space secrets** page. A Personal secret does
   not work on the Host.
4. On the Host's Agents page, add a Model Profile on **OpenJev**. Set the
   base URL to `http://openjev:8080`, the name of the service on the
   compose network.
5. Click **Test address**, pick `laya-1.0`, and save.
6. In the flow, let the Decision node pick that profile.

The full OpenJev with DiffusionGemma needs an NVIDIA GPU. Its own
`docker-compose.yml` runs it. Put that service on the Host's network in
the same way.

## OpenJev on a Mac

On Apple silicon, OpenJev runs DiffusionGemma in its own process through
MLX. The 4-bit weights need about 16 GB of memory.

1. Install and start OpenJev on the Mac:

   ```bash
   pip install -e '.[mlx]'
   OPENJEV_BACKEND=mlx python -m openjev   # serves 127.0.0.1:8080
   ```

2. On the Mac, open Night Shift and go to the Agents page.
3. Add a Model Profile on **OpenJev**, with the base URL
   `http://127.0.0.1:8080`.
4. Click **Test address**, pick `openjev-latest`, and save.
5. In the flow, let the Decision node pick that profile. The profile
   belongs to the Mac, so the step runs on the Mac, also when the Host
   starts the run.

The Host cannot reach `127.0.0.1` of the Mac, and it does not have to.
When the Mac is offline, the step waits for it, unless the node lists a
backup profile on another computer.

## Ollama on this computer

The `ollama` decider needs no address and no key. It asks the Ollama that
Night Shift uses: the **Ollama address** setting, else `OLLAMA_HOST`, else
`127.0.0.1:11434`. The guided setup prepares it after an agent, when you
choose **Local**:

1. On a Mac with Homebrew, it runs `brew install ollama` after you confirm.
   On a Mac without Homebrew, and on Linux, it links to Ollama's download
   page. The vendor's Linux script needs `sudo`, so Night Shift does not
   run it. A container image has Ollama already.
2. If Ollama is installed but does not answer, it sets **Search by
   meaning** to start Ollama with Night Shift (`ollama: on`).
3. It downloads `llama3.2:latest`, about 2 GB. The person sees the size
   first.
4. It makes the Model Profile `local` (`ollama` and that model) and makes
   `ollama` the decider of new Decision nodes.

An Ollama that Night Shift starts keeps its models in `<data dir>/ollama`.
Night Shift then also downloads the embedding model of search by meaning,
about 640 MB. A Model Profile on `ollama` without an address offers
**Download** for its model when Ollama lacks it.

Until the owner saves a decider, new Decision nodes start on TypeSafe Jev
when `TYPESAFE_API_KEY` is set, else on Ollama. A node that names no
decider runs on TypeSafe Jev, so no flow file changes.

## Another OpenAI-compatible server

LM Studio, llama-server, mlx-lm and vLLM serve OpenAI-compatible chat. Use
the `compatible` decider for them.

1. Start the server, for example LM Studio's server on
   `http://127.0.0.1:1234`.
2. Add a Model Profile on **OpenAI-compatible server**, with that base URL.
3. Click **Test address**, and pick the model that the server runs.

A `compatible` profile makes a Value, and it picks for a Decision. It
gives no probability.
