declare const rows: unique symbol;

/**
 * The statements of one `db.batch`, opaque outside the database adapter
 * that makes them (G2 of the stores plan). A port names it, so no ring of
 * a slice names a database type. The adapter that makes the statements
 * casts them to it, and the adapter that runs the batch casts them back.
 * A part of a batch with nothing to change is the empty array: it needs
 * no cast.
 */
export type RowBatch =
	| readonly []
	| (readonly unknown[] & { readonly [rows]: true });
