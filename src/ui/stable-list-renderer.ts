export interface ReplaceChildrenTarget<TNode> {
  replaceChildren(...nodes: TNode[]): void;
}

export interface StableListRenderer<TItem> {
  render(items: readonly TItem[]): boolean;
  invalidate(): void;
}

export function createStableListRenderer<TItem, TNode>(input: {
  target: ReplaceChildrenTarget<TNode>;
  createNode: (item: TItem) => TNode;
  fingerprint: (item: TItem) => unknown;
}): StableListRenderer<TItem> {
  let renderedFingerprint: string | undefined;

  return {
    render(items): boolean {
      const nextFingerprint = JSON.stringify(items.map(input.fingerprint));
      if (nextFingerprint === renderedFingerprint) return false;

      input.target.replaceChildren(...items.map(input.createNode));
      renderedFingerprint = nextFingerprint;
      return true;
    },
    invalidate(): void {
      renderedFingerprint = undefined;
    }
  };
}
