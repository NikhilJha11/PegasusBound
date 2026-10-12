import { vi } from 'vitest'

export interface WireMessage {
    topic: string
    event: string
    payload: Record<string, unknown>
    ref?: string
    join_ref?: string
}

export interface FakeSocket {
    url: string
    readyState: number
    onopen: ((e: unknown) => void) | null
    onmessage: ((e: { data: string }) => void) | null
    onclose: ((e: unknown) => void) | null
    onerror: ((e: unknown) => void) | null
    send(data: string): void
    close(): void
}

export interface SocketEnv {
    /** Every frame the client put on the wire, in order. */
    sent: WireMessage[]
    /** Every socket the provider opened. */
    instances: FakeSocket[]
    joins(topic?: string): WireMessage[]
    leaves(topic?: string): WireMessage[]
    lastJoin(topic: string): WireMessage
    /** Deliver a server frame on the newest socket. */
    deliver(msg: Record<string, unknown>): void
    /** Answer a join with `status: "ok"`. */
    ackJoin(join: WireMessage, response?: Record<string, unknown>): void
    /** Answer a join with `status: "error"` and the given response body. */
    refuseJoin(join: WireMessage, response: Record<string, unknown>): void
    /** Push a channel event to the client. */
    pushEvent(topic: string, event: string, payload?: Record<string, unknown>): void
}

/**
 * Installs a fake WebSocket and a stubbed `getSocket`, and returns handles for
 * driving the server side of the conversation.
 *
 * Call `vi.mock('@/lib/api/client/app/socket/getSocket', ...)` in the test file
 * itself — vitest hoists mocks per module, so it cannot live in here.
 */
export function installFakeSocket(): SocketEnv {
    const sent: WireMessage[] = []
    const instances: FakeSocket[] = []

    class FakeWS implements FakeSocket {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3

        readyState = 1
        onopen: ((e: unknown) => void) | null = null
        onmessage: ((e: { data: string }) => void) | null = null
        onclose: ((e: unknown) => void) | null = null
        onerror: ((e: unknown) => void) | null = null

        constructor(public url: string) {
            instances.push(this)
            // Opens on the next tick, like a real handshake.
            setTimeout(() => this.onopen?.({}), 0)
        }

        send(data: string) {
            const msg = JSON.parse(data) as WireMessage
            sent.push(msg)
            // Answer heartbeats like a live server. Without this the client's
            // zombie-socket watchdog fires, closes the socket and reconnects,
            // which rejoins every channel — noise that swamps any test running
            // longer than one heartbeat interval.
            if (msg.topic === 'phoenix' && msg.event === 'heartbeat') {
                setTimeout(() => {
                    this.onmessage?.({
                        data: JSON.stringify({
                            topic: 'phoenix',
                            event: 'phx_reply',
                            ref: msg.ref,
                            payload: { status: 'ok', response: {} },
                        }),
                    })
                }, 0)
            }
        }

        close() {
            this.readyState = FakeWS.CLOSED
            this.onclose?.({ wasClean: true })
        }
    }

    ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS

    const socket = () => instances[instances.length - 1]

    const env: SocketEnv = {
        sent,
        instances,
        joins: (topic) =>
            sent.filter((m) => m.event === 'phx_join' && (!topic || m.topic === topic)),
        leaves: (topic) =>
            sent.filter((m) => m.event === 'phx_leave' && (!topic || m.topic === topic)),
        lastJoin: (topic) => {
            const all = env.joins(topic)
            if (all.length === 0) throw new Error(`no phx_join for ${topic}`)
            return all[all.length - 1]
        },
        deliver: (msg) => socket().onmessage?.({ data: JSON.stringify(msg) }),
        ackJoin: (join, response = {}) =>
            env.deliver({
                topic: join.topic,
                event: 'phx_reply',
                ref: join.ref,
                join_ref: join.join_ref,
                payload: { status: 'ok', response },
            }),
        refuseJoin: (join, response) =>
            env.deliver({
                topic: join.topic,
                event: 'phx_reply',
                ref: join.ref,
                join_ref: join.join_ref,
                payload: { status: 'error', response },
            }),
        pushEvent: (topic, event, payload = {}) => env.deliver({ topic, event, payload }),
    }

    return env
}

/** Freeze the jitter the provider applies to backoff delays. */
export function freezeJitter(value = 0) {
    return vi.spyOn(Math, 'random').mockReturnValue(value)
}
