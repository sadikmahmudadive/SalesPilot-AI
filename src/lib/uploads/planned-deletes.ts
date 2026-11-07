/**
 * Which uploaded assets may be deleted, and when. Pure.
 *
 * Deleting an asset a saved product still references would break that product (later saves are
 * rejected because the upload record is gone), so an asset the persisted product points at is only
 * deleted AFTER a save that no longer references it. An asset nothing persisted points at (it was
 * uploaded in this editing session and never saved) can go immediately.
 *
 * Inputs are Cloudinary public ids:
 * - `baseline`: the images of the last saved product (empty for a new product);
 * - `saved`: the images the product has after a successful save, or `null` before one;
 * - `sessionUploads`: every id uploaded in this editing session;
 * - `removedBeforeSave`: ids the user removed from the form since the last save.
 *
 * Nothing in `saved` is ever returned. Discarding the form leaves session uploads as confirmed
 * orphans; a cleanup job for those is future work.
 */
export interface PlannedDeletesInput {
  baseline: readonly string[];
  saved: readonly string[] | null;
  sessionUploads: readonly string[];
  removedBeforeSave: readonly string[];
}

export interface PlannedDeletes {
  /** Safe to delete now: nothing persisted references them. */
  immediate: string[];
  /** Delete in the background once the save succeeded: the previous version referenced them. */
  afterSave: string[];
}

export function plannedDeletes({
  baseline,
  saved,
  sessionUploads,
  removedBeforeSave,
}: PlannedDeletesInput): PlannedDeletes {
  const persisted = new Set(baseline);
  const uploaded = new Set(sessionUploads);
  const stillSaved = new Set(saved ?? []);

  const immediate = [...new Set(removedBeforeSave)].filter(
    (id) => uploaded.has(id) && !persisted.has(id) && !stillSaved.has(id),
  );
  const afterSave =
    saved === null ? [] : [...new Set(baseline)].filter((id) => !stillSaved.has(id));
  return { immediate, afterSave };
}
