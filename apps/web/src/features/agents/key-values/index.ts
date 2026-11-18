/** Rows of a name and a value: the variables of a program and the headers of a request. It holds no query, so a draft module can import it. */

export {
	type KeyValueRow,
	KeyValueRows,
	newRow,
	recordFrom,
	rowsFrom,
} from "./key-value-rows";
