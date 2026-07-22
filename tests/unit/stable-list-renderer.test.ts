import { createStableListRenderer } from '../../src/ui/stable-list-renderer';

interface Item {
  id: string;
  label: string;
}

interface FakeNode {
  id: string;
  label: string;
}

function createFocusAwareTarget() {
  return {
    children: [] as FakeNode[],
    focused: null as FakeNode | null,
    replaceChildren(...nodes: FakeNode[]): void {
      this.children = nodes;
      if (this.focused && !nodes.includes(this.focused)) this.focused = null;
    }
  };
}

test('preserves rendered node identity and focus when list contents are unchanged', () => {
  const target = createFocusAwareTarget();
  const renderer = createStableListRenderer<Item, FakeNode>({
    target,
    fingerprint: (item) => [item.id, item.label],
    createNode: (item) => ({ ...item })
  });

  expect(renderer.render([{ id: 'candidate-1', label: 'Jump to 1:20' }])).toBe(true);
  const focused = target.children[0] ?? null;
  target.focused = focused;

  expect(renderer.render([{ id: 'candidate-1', label: 'Jump to 1:20' }])).toBe(false);
  expect(target.children[0]).toBe(focused);
  expect(target.focused).toBe(focused);
});

test('replaces changed items and removes stale items', () => {
  const target = createFocusAwareTarget();
  const renderer = createStableListRenderer<Item, FakeNode>({
    target,
    fingerprint: (item) => [item.id, item.label],
    createNode: (item) => ({ ...item })
  });

  renderer.render([{ id: 'evidence-1', label: 'QR · 82%' }]);
  const original = target.children[0];
  target.focused = original ?? null;

  expect(renderer.render([{ id: 'evidence-1', label: 'QR · 91%' }])).toBe(true);
  expect(target.children[0]).not.toBe(original);
  expect(target.children[0]?.label).toBe('QR · 91%');
  expect(target.focused).toBeNull();

  expect(renderer.render([])).toBe(true);
  expect(target.children).toEqual([]);
});
