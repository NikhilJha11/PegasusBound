import { useContext, createContext, useEffect, useCallback, useRef } from "react";

// Phoenix-compatible message format
export interface ChannelMessage {
    topic: string;
    event: string;
    payload: Record<string, unknown>;
    ref?: string;
    join_ref?: string;
}

// Channel state
export type ChannelState = "closed" | "joining" | "joined" | "leaving" | "errored";

// Channel info
export interface ChannelInfo {
    topic: string;
    state: ChannelState;
    joinRef: string;
}

// Handler types
export type ChannelEventHandler = (payload: Record<string, unknown>) => void;

interface SocketContextValue {
    // Connection state
    isConnected: boolean;
    reconnectAttempt: number;
    error?: boolean;
    message?: string;

    // Channel management
    joinChannel: (topic: string, params?: Record<string, unknown>) => void;
    leaveChannel: (topic: string) => void;
    getChannelState: (topic: string) => ChannelState;
    // Reactive mirror of every channel's state, keyed by topic. getChannelState
    // reads a ref, so a component that renders it never re-renders when the
    // channel actually joins — which is how a live campaign's panel sat on
    // "Disconnected" forever (issue #189). Render from this.
    channelStates: Record<string, ChannelState>;

    // Event handling
    subscribeToChannel: (
        topic: string,
        event: string,
        handler: ChannelEventHandler
    ) => () => void;

    // Push message to channel
    pushToChannel: (topic: string, event: string, payload: Record<string, unknown>) => void;

    // Legacy support - subscribe to any message type
    subscribe: <T extends { type: string }>(
        type: T['type'],
        handler: (msg: T) => void
    ) => () => void;

    // Send raw message
    sendMessage: (msg: unknown) => void;
}

export const SocketContext = createContext<SocketContextValue | undefined>(undefined);

export const useSocket = (): SocketContextValue => {
    const ctx = useContext(SocketContext);
    if (!ctx) {
        throw new Error('useSocket must be used within a <SocketProvider />');
    }
    return ctx;
};

// Hook to join a channel and subscribe to events
export function useChannel(topic: string, params?: Record<string, unknown>) {
    const socket = useSocket();
    const { joinChannel, leaveChannel, pushToChannel, channelStates } = socket;

    // Depend on the two stable callbacks, never on the context value itself:
    // channelStates re-renders the provider on every join, so an effect keyed on
    // the whole socket left and rejoined the channel on every render.
    // params is an object literal at its call sites, so key on its value.
    const paramsKey = params ? JSON.stringify(params) : "";
    const paramsRef = useRef(params);
    paramsRef.current = params;

    useEffect(() => {
        joinChannel(topic, paramsRef.current);
        return () => {
            leaveChannel(topic);
        };
    }, [joinChannel, leaveChannel, topic, paramsKey]);

    return {
        state: channelStates[topic] ?? "closed",
        push: (event: string, payload: Record<string, unknown>) =>
            pushToChannel(topic, event, payload),
    };
}

// Hook to subscribe to a specific event on a channel
export function useChannelEvent(
    topic: string,
    event: string,
    handler: ChannelEventHandler,
    deps: React.DependencyList = []
) {
    const { subscribeToChannel } = useSocket();
    const handlerRef = useRef(handler);

    // Update handler ref when it changes
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    // Same reason as useChannel: subscribeToChannel is stable, the context value
    // is not, so depending on the whole socket resubscribed on every render.
    useEffect(() => {
        const wrappedHandler: ChannelEventHandler = (payload) => {
            handlerRef.current(payload);
        };

        const unsubscribe = subscribeToChannel(topic, event, wrappedHandler);
        return unsubscribe;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subscribeToChannel, topic, event, ...deps]);
}

// Convenience hook combining channel join and event subscription
export function useChannelSubscription<T extends Record<string, unknown>>(
    topic: string,
    event: string,
    handler: (payload: T) => void,
    params?: Record<string, unknown>
) {
    const channel = useChannel(topic, params);

    useChannelEvent(topic, event, handler as ChannelEventHandler);

    return channel;
}
