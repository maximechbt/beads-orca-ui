// Types for the parts of panel/vendor/preact.js the panel uses.
export type VNode = { type: unknown; props: unknown; key?: unknown }
export type ComponentChildren = VNode | string | number | boolean | null | undefined | ComponentChildren[]

/** Tagged templates that read like JSX: html`<div class=${c}>${children}</div>`. */
export declare const html: (strings: TemplateStringsArray, ...values: unknown[]) => VNode
export declare function h(type: unknown, props: Record<string, unknown> | null, ...children: ComponentChildren[]): VNode
export declare function render(tree: VNode, parent: Element): void

export declare abstract class Component<P = object, S = object> {
  constructor(props?: P)
  props: P
  state: S
  shouldComponentUpdate?(nextProps: P, nextState: S): boolean
  abstract render(props?: P, state?: S): ComponentChildren
}

export declare function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
export declare function useEffect(effect: () => void | (() => void), deps?: unknown[]): void
export declare function useLayoutEffect(effect: () => void | (() => void), deps?: unknown[]): void
export declare function useRef<T>(initial: T): { current: T }
export declare function useMemo<T>(factory: () => T, deps: unknown[]): T
