export const BUY_STAGES=["Lead Received","Appointment Scheduled","Offer Made","Purchased","Transport","Processing","Grading","Listing","Sold"];
export const INV_STAGES=["Purchased","Checked In","Sorted","Graded","Priced","Photographed","Listed Online","Moved to Floor","Sold"];
/** Full lot lifecycle. Merchandise Pipeline and lot profit still use these names. */
export const LOT_STAGES=["Sourcing","Purchased","Receiving","Processing","Inventory","Listed"];
/** Buying Pipeline work columns. A new buy is created already Purchased, then moves to Processing, then to Inventory (the merchandise handoff). */
export const BUYING_FLOW_STAGES=["Purchased","Processing"];
/** Early lead and offer stages removed from the buying flow. Existing lots stay stored and show in the Legacy leads column. */
export const LEGACY_LEAD_STAGES=["Sourcing","Lead Received","Appointment Scheduled","Offer Made"];
