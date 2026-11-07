/**
 * Where keyboard focus goes after an image is removed (the focused remove button disappears, which
 * would otherwise drop focus to the page). Pure.
 *
 * `count` is the number of images before the removal. Returns the index, in the list AFTER the
 * removal, of the remove button to focus: the next image (it now sits at `removedIndex`), else the
 * previous one, else `"uploader"` when no image is left.
 */
export function focusAfterRemove(count: number, removedIndex: number): number | "uploader" {
  const remaining = count - 1;
  if (remaining <= 0 || removedIndex < 0 || removedIndex >= count) return "uploader";
  return removedIndex < remaining ? removedIndex : removedIndex - 1;
}
