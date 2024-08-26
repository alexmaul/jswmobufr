/**
 * Javascript-module decoding WMO FM94 BUFR.
 *
 * Author(s):
 *   Alexander Maul <alexander.maul@dwd.de>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */
const JsWmoBufrReader = class {

    /** Allowed output modes. */
    static modes = ["text", "json"];

    /** Constructor.
     *
     * @param {String} mode - Output mode.
     * @param {Object} tables - Dictionary holding all table data.
     */
    constructor(mode, tables) {
        if (JsWmoBufrReader.modes.indexOf(mode) === -1) {
        }
        this.mode = mode;
        switch (mode) {
            case "text":
                this.write = this.write_text;
                break;
            case "json":
                this.write = this.write_json;
                break;
            default:
                throw new Error("Wrong decoder mode!");
        }
        /* table store */
        this.tables_all = tables;
        this.tables = tables.wmo;
        /* inital values for decoder */
        this.octets = "";
        this.bits_offset = 0;
        this.numberOfSubsets = 0;
        this.compression = false;
        this.modifier = {
            scale: null,
            ref_mul: null,
            ref_val: {},
            width_bit: null,
            width_char: null,
            assoc: [0],
            ieee: null
        };
        /*
        initialise buffer and tempo-spatial resolver for writing decoded info
         */
        this.subset_current_time = new Date();
        this.subset_current_time.setUTCSeconds(0);
        this.subset_current_time.setUTCMilliseconds(0);
        this.write_buffer = [];
        this.write_buffer_default = {
            state: {
                /* special state keys for timey wobbling */
                time: 0, time_increment: 0
            },
            values: []
        }
        this.no_unit = ["CCITT IA5", "CODE TABLE", "FLAG TABLE"];
        this.state_timestuff = {
            set: {
                "004006": (x) => this.subset_current_time.setUTCSeconds(x),
                "004005": (x) => this.subset_current_time.setUTCMinutes(x),
                "004004": (x) => this.subset_current_time.setUTCHours(x),
                "004003": (x) => this.subset_current_time.setUTCDate(x),
                "004002": (x) => this.subset_current_time.setUTCMonth(x - 1),
                "004001": (x) => this.subset_current_time.setUTCFullYear(x)
            },
            inc: {
                "004016": 1, "004015": 60, "004014": 3600, "004013": 86400,
                "004066": 1, "004065": 60
            }
        };
    }

    write_text(obj) {
        /* obj: {desc,entry,val,assoc} */
        if (obj.subset) {
            this.write_buffer.push(` SUBSET${this.compression ? "S:" : ""} ${obj.subset} `.padStart(40, "=").padEnd(80, "="));
            return;
        }
        let value = obj.val;
        if (obj.entry && obj.entry.type) {
            if (obj.entry.type === "table") {
                value = value.map(
                    (a) => {
                        if (a === null || (!this.tables.codetables[obj.desc])) {
                            return "MISSING";
                        }
                        else {
                            return this.tables.codetables[obj.desc][a];
                        }
                    });
            }
            else if (obj.entry.type === "flag") {
                value = value.map((a) => {
                    if (a === null) {
                        return "MISSING";
                    }
                    let foo = [];
                    for (let k in this.tables.codetables[obj.desc]) {
                        if (a & (1 << (obj.entry.width - k))) {
                            foo.push(this.tables.codetables[obj.desc][k]);
                        }
                    }
                    return foo.join("|");
                });
            }
        }
        let buf = [];
        if (obj.entry) {
            buf = [
                (obj.desc ? obj.desc : "").padStart(6),
                (obj.entry.snam ? obj.entry.snam : "").padEnd(50), "=",
                value.map((a) => { return (a !== null) ? a : "MISSING" }).toString().padStart(10),
                ((obj.entry.unit && (this.no_unit.indexOf(obj.entry.unit) < 0)) ? `[${obj.entry.unit}]` : "").padEnd(5),
                (obj.assoc.length ? "Q:" + obj.assoc : "").toString().padStart(3)
            ].join(" ");
        }
        else if (obj.repl) {
            buf = [
                "replication",
                obj.repl,
                (obj.val != undefined ? obj.val : "")
            ].join(" ");
        }
        else {
            buf = [
                (obj.name ? obj.name : "").padEnd(57), "=",
                ((value !== null) ? value : "MISSING").toString().padStart(10)
            ].join(" ");
        }
        this.write_buffer.push(buf);
    }

    write_json(obj) {
        /* obj: {desc,entry,val,assoc} */
        if (!(obj.desc || obj.repl)) {
            return;
        }
        let last_write = this.write_buffer[this.write_buffer.length - 1];
        if (obj.repl == "step") {
            if (last_write.state.time_increment) {
                if (obj.val > 0) {
                    last_write.state.time += last_write.state.time_increment;
                }
                this.write_buffer.push({ state: { ...last_write.state }, values: [] });
            }
        }
        else if (obj.repl == "stop" || obj.repl == "skip") {
            last_write.state.time_increment = 0;
        }
        else {
            const fxy = this.str2fxy(obj.desc);
            if (fxy.f == 0 && fxy.x < 10) {
                /* class 01 to 09 */
                let cur_state = { ...last_write.state };
                if (obj.desc in this.state_timestuff.set) {
                    /* change backing time object and store epoch */
                    cur_state.time = this.state_timestuff.set[obj.desc](obj.val[0]) / 1000;
                }
                else if (obj.desc in this.state_timestuff.inc) {
                    /* set/apply time increment */
                    cur_state.time_increment = obj.val * this.state_timestuff.inc[obj.desc];
                    cur_state.time += cur_state.time_increment;
                }
                else {
                    if (obj.val.every((x) => x === null)) {
                        delete cur_state[obj.entry.snam];
                    }
                    else {
                        cur_state[obj.entry.snam] = obj.val;
                    }
                }
                if (last_write.values.length > 0) {
                    this.write_buffer.push({ state: { ...cur_state }, values: [] });
                }
                else {
                    last_write.state = { ...cur_state };
                }
            }
            else {
                /* append value/assoc */
                last_write.values.push({
                    desc: obj.desc,
                    snam: obj.entry.snam,
                    value: obj.val,
                    assoc: obj.assoc
                });
            }
        }
    }

    isEnd() {
        return Math.floor(this.bits_offset / 8) > this.octets.length;
    }

    resetToByte(new_byte_offset) {
        this.bits_offset = new_byte_offset * 8;
        if (this.isEnd()) {
            throw new Error("Read after end!");
        }
    }

    readBits(nbits, asChars = false) {
        let bnbits = BigInt(nbits);
        let octet_start = Math.floor(this.bits_offset / 8);
        let octet_idx = octet_start;
        let bit_start = BigInt(this.bits_offset % 8);  // start with bit in octet
        let bit_rest = (8n - ((bit_start + bnbits) % 8n)) % 8n;  // leave bits in last octet
        let procbits = -bit_start  // bits processed/transfered to val
        let val_num = 0n;
        let val_chars = [];
        while (procbits < bnbits) {
            if (octet_idx > octet_start) {
                val_num <<= 8n
            }
            val_num |= BigInt(this.octets[octet_idx].charCodeAt(0) & 0xFF);
            octet_idx += 1;
            procbits += 8n;
            if (asChars == true && procbits >= 8n) {
                val_chars.push(String.fromCharCode(Number((val_num >> bit_rest) & 0xFFn)));
            }
        }
        if (asChars == true) {
            val_num = val_chars.join("");
        }
        else {
            val_num = Number((val_num >> bit_rest) & ((1n << bnbits) - 1n));
        }
        this.bits_offset += nbits;
        if (this.isEnd()) {
            throw new Error("Read after end!");
        }
        return val_num;
    }

    readFXY() {
        const f = this.readBits(2);
        const x = this.readBits(6);
        const y = this.readBits(8);
        const s = f.toString() + x.toString().padStart(2, "0") + y.toString().padStart(3, "0");
        return s;
    }

    str2fxy(str) {
        const f = parseInt(str.substring(0, 1));
        const x = parseInt(str.substring(1, 3));
        const y = parseInt(str.substring(3));
        return { f: f, x: x, y: y };
    }

    readValue(desc, tab_entry) {
        // Don't use modifiers on this types
        const no_mod_types = ["string", "table", "flag"];
        // The "missing-value" bit-masks for IEEE float/double
        const IEEE_INF = { 32: 0x7f7fffffn, 64: 0x7fefffffffffffffn }
        let rval_list = [];
        let assoc_list = [];
        let val_list;
        let loc_width = tab_entry.width;
        let loc_scale = tab_entry.scale;
        let loc_ref = tab_entry.ref;
        if (tab_entry.type === "string" && this.modifier.width_char !== null) {
            loc_width = this.modifier.width_char;
        }
        else if (
            (tab_entry.type == "long" || tab_entry.type == "double")
            && this.modifier.ieee
        ) {
            loc_width = this.modifier.ieee;
        }
        else {
            if (
                (no_mod_types.indexOf(tab_entry.type) < 0)
                && (desc < "031000" || desc >= "032000")
            ) {
                if (this.modifier.width_bit !== null) {
                    loc_width += this.modifier.width_bit;
                }
                if (this.modifier.scale !== null) {
                    loc_scale += this.modifier.scale;
                }
                if (this.modifier.ref_val !== null && this.modifier.ref_val[desc]) {
                    loc_ref = this.modifier.ref_val[desc];
                }
                else if (this.modifier.ref_mul !== null) {
                    loc_ref *= this.modifier.ref_mul;
                }
            }
        }
        if (this.compression) {
            let r0, nbinc;
            if (this.modifier.assoc[0] > 0 && (desc < "031000" || desc >= "032000")) {
                /* for associaded field values */
                assoc_list = [];
                r0 = this.readBits(this.modifier.assoc[0]);
                nbinc = this.readBits(6);
                if (nbinc == 0) {
                    /* all values are the same, use R0 */
                    for (let i = 0; i < this.numberOfSubsets; i++) {
                        assoc_list.push(r0);
                    }
                }
                else {
                    for (let i = 0; i < this.numberOfSubsets; i++) {
                        assoc_list.push(r0 + this.readBits(nbinc));
                    }
                }
            }
            /* regular data values */
            r0 = this.readBits(loc_width, (tab_entry.type === "string"));
            nbinc = this.readBits(6);
            if (nbinc == 0) {
                /* all values are the same, use R0 */
                for (let i = 0; i < this.numberOfSubsets; i++) {
                    rval_list.push(r0);
                }
            }
            else {
                if (tab_entry.type === "string") {
                    for (let i = 0; i < this.numberOfSubsets; i++) {
                        rval_list.push(this.readBits(nbinc * 8, true));
                    }
                }
                else {
                    for (let i = 0; i < this.numberOfSubsets; i++) {
                        rval_list.push(r0 + this.readBits(nbinc));
                    }
                }
            }
        }
        else {
            /* no compression */
            if (this.modifier.assoc[0] > 0 && (desc < "031000" || desc >= "032000")) {
                assoc_list = [this.readBits(this.modifier.assoc[0])];
            }
            rval_list = [this.readBits(loc_width, (tab_entry.type === "string"))];
        }
        val_list = rval_list.map((rval) => {
            if (tab_entry.type === "string") {
                if (rval.split("").every(x => x.charCodeAt(0) == 0xFF)) {
                    return null;
                }
                else {
                    return rval;
                }
            }
            else if (this.modifier.ieee) {
                // TODO test if working
                if (rval & IEEE_INF[this.modifier.ieee]) {
                    return null;
                }
                const ieee_buffer = new ArrayBuffer(8);
                const ieee_view = new DataView(ieee_buffer);
                if (this.modifier.ieee == 32) {
                    ieee_view.setUint32(0, rval, false);
                    return ieee_view.getFloat32(0, false);
                }
                else if (this.modifier.ieee == 64) {
                    ieee_view.setBigUint64(0, rval, false);
                    return ieee_view.getFloat64(0, false);
                }
                else {
                    console.error(`Error unpacking ${this.modifier.ieee} bit IEEE!`)
                    return null;
                }
            }
            else {
                if ((rval ^ ((1 << loc_width) - 1)) == 0) {
                    if ((desc < "031000") || (desc >= "031020")) {
                        /* Value=MISSING if all bits are set,
                        unless for delayed replication/repetition. */
                        return null
                    }
                }
                return (rval + loc_ref) / 10 ** loc_scale;
            }
        });
        return { assoc: assoc_list, value: val_list };
    }

    alignOnByte(even = false) {
        let align = 8 - (this.bits_offset % 8);
        if (align < 8) {
            this.readBits(align);
        }
        if (even && (this.bits_offset / 8) % 2) {
            this.readBits(1 * 8);
        }
        if (this.isEnd()) {
            throw new Error("Read after end!");
        }
    }

    operator(process_desc = []) {
        let ret_val = null;
        let proc_desc = 1;
        let desc = process_desc[0];
        let fxy = this.str2fxy(desc);
        switch (fxy.x) {
            case 1:
                /* Change data width */
                if (fxy.y > 0) {
                    this.modifier.width_bit = fxy.y - 128;
                }
                else {
                    this.modifier.width_bit = null;
                }
                break;
            case 2:
                /* Change scale */
                if (fxy.y > 0) {
                    this.modifier.scale = fxy.y - 128;
                }
                else {
                    this.modifier.scale = null;
                }
                break;
            case 3:
                /* Set of new reference values */
                if (fxy.y > 0) {
                    [this.modifier.ref_val, proc_desc] = this.readRefValList(process_desc);
                }
                else {
                    this.modifier.ref_val = null;
                }
                break;
            case 4:
                /* Add associated field, shall be followed by 031021.
                Manages stack for associated field, the value added last shall be used. */
                if (fxy.y == 0) {
                    if (this.modifier.assoc.shift() == 0) {
                        this.modifier.assoc.unshift(0);
                    }
                }
                else {
                    this.modifier.assoc.unshift(this.modifier.assoc[0] + fxy.y);
                }
                break;
            case 5:
                /* Signify with characters, plain language text as returned value */
                ret_val = this.readValue(desc, { type: "string", width: (fxy.y * 8), scale: 0, ref: 0 });
                break;
            case 6:
                /* Length of local descriptor */
                const r = this.readValue(desc, { type: "flag", width: fxy.y, scale: 0, ref: 0 });
                proc_desc++;
                this.write({
                    desc: process_desc[proc_desc - 1],
                    entry: { snam: "localDescriptor", type: "long" },
                    val: r.value,
                    assoc: []
                });
                break;
            case 7:
                /* Change scale, reference, width */
                if (fxy.y === 0) {
                    this.modifier.scale = null;
                    this.modifier.ref_mul = null;
                    this.modifier.width_bit = null;
                }
                else {
                    this.modifier.scale = fxy.y;
                    this.modifier.ref_mul = 10 ** fxy.y;
                    this.modifier.width_bit = Math.floor(((10 * fxy.y) + 2) / 3);
                }
                break;
            case 8:
                /* Change data width for characters */
                if (fxy.y > 0) {
                    this.modifier.width_char = fxy.y * 8;
                }
                else {
                    this.modifier.width_char = null;
                }
                break;
            case 9:
                /* IEEE floating point representation */
                this.modifier.ieee = fxy.y;
            /*
            TODO: implement more operators.
            */
            default:
                throw new Error("OPERATOR not implemented: " + desc);
        }
        return { value: ret_val, processed: proc_desc };
    }

    /*
     * Set new reference values.
     *
     * Reads a set of YYY bits, taking them as new reference values for the
     * descriptors of the set. YYY is taken from the current descriptor dl[di],
     * reference values are set for all subsequent following descriptors until
     * the descriptor signaling the end of operation occurs.
     *
     * @param {process_desc} [String, ...] - list of descriptors to process, including start+end operator.
     * @return [Object, Object] - list of new reference values, number of processed descriptors
     */
    readRefValList(process_desc) {
        let rl = {};
        let fxy, sign, rval, desc;
        let an = this.str2fxy(process_desc[0]).y;
        for (let di = 1; di < process_desc.length; di++) {
            desc = process_desc[di];
            fxy = this.str2fxy(desc);
            if (fxy.f == 2 && fxy.x == 3 && fxy.y == 255) {
                // YYY==255 is signal-of-end
                break;
            }
            rval = this.readValue(desc, { type: "flag", width: an, scale: 0, ref: 0 });
            // Sign=high-bit
            if ((1 << (an - 1)) & rval.value[0]) {
                sign = -1;
            }
            else {
                sign = 1;
            }
            // Value=val&(FFF>>1)
            rl[desc] = sign * (((1 << an) - 1) & rval.value[0])
        }
        return [rl, Object.keys(rl).length + 2];
    }

    /*
     * Loop over all descriptors in desc_list, processing hem accordingly.
     */
    loop(desc_list) {
        let tab_entry, val;
        for (let di = 0; di < desc_list.length; di++) {
            let desc = desc_list[di];
            const desc_fxy = this.str2fxy(desc);
            if (desc === "000000") {
                continue;
            }
            switch (desc_fxy.f) {
                case 0:
                    tab_entry = this.tables.elements[desc];
                    val = this.readValue(desc, tab_entry);
                    this.write({
                        desc: desc,
                        entry: tab_entry,
                        val: val.value,
                        assoc: val.assoc
                    });
                    break;
                case 1:
                    let repl_size = desc_fxy.x;
                    let repl_count = desc_fxy.y;
                    if (repl_count == 0) {
                        di++;
                        repl_count = this.readValue(desc_list[di], this.tables.elements[desc_list[di]]).value[0];
                    }
                    di++;
                    let repl_step = repl_count;
                    if (repl_count == 0) {
                        this.write({ repl: "skip" });
                    }
                    else {
                        while (repl_step > 0) {
                            this.write({ repl: "step", val: repl_count - repl_step });
                            this.loop(desc_list.slice(di, di + repl_size));
                            repl_step--;
                        }
                        this.write({ repl: "stop" });
                    }
                    di += repl_size - 1;
                    break;
                case 2:
                    let op_ret = this.operator(desc_list.slice(di));
                    if (op_ret.value !== null) {
                        this.write({
                            name: desc,
                            val: op_ret.value.value
                        });
                    }
                    di += op_ret.processed - 1;
                    break;
                case 3:
                    this.loop(this.tables.sequence[desc]);
                    break;
                default:
                    throw new Error(`Illegal descriptor ${desc}`);
            }
        }
    }

    /** Decode string with binary BUFR data.
     *
     * Returns an array, depending on decoding mode, with:
     * Mode text: lines of text,
     *    [string, ...]
     * Mode json: objects with spatial state data, associated field data and data values.
     *     [{spat:{...}, assoc:[...], value:[...]}]
     *
     * @param {octets} String - BUFR data.
     * @return Array - decoded data.
     */
    decode(octets) {
        this.write_buffer = [];
        if (this.mode === "json") {
            this.write_buffer.push(this.write_buffer_default);
        }
        this.octets = octets;
        this.bits_offset = 0;
        let buf = [];
        let section_length = 0;
        let section_end = 0;
        let key_offs;
        let has_section2 = 0;
        let desc_list = [];
        let collect_meta = {};
        /*
        Sect.0
        */
        buf = this.readBits(4 * 8, true);
        if (buf !== "BUFR") {
            throw new Error(`Invalid sect.0 start! ('${buf}' != not 'BUFR')`);
        }
        this.length_total = this.readBits(3 * 8);
        this.bufrEdition = this.readBits(1 * 8);
        collect_meta["bufrEdition"] = this.bufrEdition;
        this.write({ name: "bufrEdition", val: this.bufrEdition });
        section_end = 8;
        /*
        Sect.1
        */
        section_length = this.readBits(3 * 8);
        section_end += section_length;
        key_offs = {
            3: [
                ["masterTableNumber", 8], ["bufrHeaderSubCentre", 8],
                ["bufrHeaderCentre", 8], ["updateSequenceNumber", 8],
                ["section2present", 1], [null, 7], ["dataCategory", 8],
                ["dataSubCategory", 8], ["masterTablesVersionNumber", 8],
                ["localTablesVersionNumber", 8], ["typicalYear", 8],
                ["typicalMonth", 8], ["typicalDay", 8], ["typicalHour", 8],
                ["typicalMinute", 8],
            ],
            4: [
                ["masterTableNumber", 8], ["bufrHeaderCentre", 16],
                ["bufrHeaderSubCentre", 16], ["updateSequenceNumber", 8],
                ["section2present", 1], [null, 7], ["dataCategory", 8],
                ["internationalDataSubCategory", 8], ["dataSubCategory", 8],
                ["masterTablesVersionNumber", 8], ["localTablesVersionNumber", 8],
                ["typicalYear", 16], ["typicalMonth", 8], ["typicalDay", 8],
                ["typicalHour", 8], ["typicalMinute", 8], ["typicalSecond", 8],
            ]
        }
        for (let key of key_offs[this.bufrEdition]) {
            buf = this.readBits(key[1]);
            if (key[0] === null) { continue; }
            if (this.bufrEdition == 3 && key[0] == "typicalYear") {
                /*
                Ed.3: year [yy], month, day, hour, minute
                Ed.4: year [yyyy], month, day, hour, minute, second
                */
                if (buf > 50) {
                    buf += 1900;
                }
                else {
                    buf += 2000;
                }
            }
            else if (key[0] === "section2present") {
                has_section2 = buf;
            }
            this.write({ name: key[0], val: buf });
            collect_meta[key[0]] = buf;
        }
        this.resetToByte(section_end);
        if (collect_meta.localTablesVersionNumber > 0) {
            /* overlay wmo tables with local set */
            const loc_id = `${collect_meta.localTablesVersionNumber}/${collect_meta.bufrHeaderCentre}/${collect_meta.bufrHeaderSubCentre}`;
            if (this.tables_all.local[loc_id]) {
                for (const x of ["elements", "sequence", "codetables"]) {
                    for (const y in this.tables_all.local[loc_id][x]) {
                        this.tables[x][y] = this.tables_all.local[loc_id][x][y];
                    }
                }
            }
            else {
                throw new Error(`Required local table ${loc_id} not available!`);
            }
        }
        /*
        Sect.2
        */
        if (has_section2) {
            section_length = this.readBits(3 * 8);
            section_end += section_length;
            this.readBits(8);
            buf = this.readBits((section_length - 4) * 8, true);
            this.write({ name: "section2", val: encodeURI(buf) });
        }
        /*
        Sect.3
        */
        section_length = this.readBits(3 * 8);
        section_end += section_length;
        this.readBits(1 * 8);
        this.numberOfSubsets = this.readBits(16);
        this.write({ name: "numberOfSubsets", val: this.numberOfSubsets });
        collect_meta["numberOfSubsets"] = this.numberOfSubsets;
        buf = this.readBits(1);
        this.write({ name: "observedData", val: buf });
        collect_meta["observedData"] = buf;
        this.compression = this.readBits(1) & 1;
        this.write({ name: "compressedData", val: this.compression });
        collect_meta["compressedData"] = this.compression;
        this.readBits(6);
        while (this.bits_offset < (section_end * 8)) {
            desc_list.push(this.readFXY());
        }
        this.write({ name: "unexpandedDescriptors", val: desc_list });
        this.resetToByte(section_end);
        /*
        Sect.4
        */
        section_length = this.readBits(3 * 8);
        section_end += section_length;
        this.readBits(1 * 8);
        if (this.compression) {
            this.write({ subset: this.numberOfSubsets });
            this.loop(desc_list);
            if (this.bufrEdition < 4) {
                this.alignOnByte(true);
            }
        }
        else {
            for (let cur_subset = 0; cur_subset < this.numberOfSubsets; cur_subset++) {
                this.write({ subset: cur_subset + 1 });
                this.loop(desc_list);
                if (this.bufrEdition < 4) {
                    this.alignOnByte(true);
                }
            }
        }
        this.alignOnByte();
        /*
        Sect.5
        */
        buf = this.readBits(4 * 8, true);
        if (buf !== "7777") {

            console.log(collect_meta, section_end, "<>", this.bits_offset / 8)
            console.error(`Invalid sect.5 end! ('${buf}' != '7777')`);

            throw new Error(`Invalid sect.5 end! ('${buf}' != '7777')`);
        }
        return this.write_buffer;
    }
}

export { JsWmoBufrReader };
