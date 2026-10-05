export interface ResourceState<T> {
  status: 'loading' | 'ready' | 'error';
  data?: T;
  error?: string;
  refreshing: boolean;
}

export interface Resource<T> {
  state: ResourceState<T>;
  refresh(): Promise<void>;
  subscribe(listener: (state: ResourceState<T>) => void): void;
}

/**
 * Data loaded from the API. Only the most recently started refresh may update the state, so a
 * slow earlier response can never overwrite a later one, whatever order responses arrive in.
 */
export function createResource<T>(load: () => Promise<T>): Resource<T> {
  const listeners: ((state: ResourceState<T>) => void)[] = [];
  let latest = 0;

  function publish(state: ResourceState<T>): void {
    resource.state = state;
    for (const listener of listeners) listener(state);
  }

  const resource: Resource<T> = {
    state: { status: 'loading', refreshing: true },
    subscribe(listener) {
      listeners.push(listener);
      listener(resource.state);
    },
    async refresh() {
      const mine = ++latest;
      publish({ ...resource.state, refreshing: true });
      try {
        const data = await load();
        if (mine === latest) publish({ status: 'ready', data, refreshing: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not load this data.';
        if (mine === latest) publish({ status: 'error', data: resource.state.data, error: message, refreshing: false });
      }
    },
  };
  return resource;
}
