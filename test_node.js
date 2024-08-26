import * as fs from "fs";
import { JsWmoBufrReader } from "./jswmobufr.js";

const muster = "QlVGUgAAywQAABYAAE4AAAAAAQAAIgAH5wEKDh44AAAJAAABgMgOAACgAH0NRREMgICAgIIcAQ/OJTnnBsk23///////////////////////////////////////////////////m23qf//////////////////a/N/////+14P//////////////////////////////////AH////////w///9jr/////////////////////9/3/z//3////4E/slgKPgADc3Nzc";
var bufr = atob(muster);
var tables;
var reader;
var file_data;
var file_name;

switch (process.argv[2]) {
    case "1":
        tables = JSON.parse(fs.readFileSync(process.argv[3]));
        reader = new JsWmoBufrReader("text", tables);
        bufr = atob(muster);
        console.log(reader.decode(bufr).join("\n"));
        break;
    case "2":
        tables = JSON.parse(fs.readFileSync(process.argv[3]));
        reader = new JsWmoBufrReader("text", tables);
        file_name = process.argv[4];
        console.log("FILE", file_name);
        file_data = fs.readFileSync(file_name, "latin1").toString();
        bufr = file_data.slice(file_data.indexOf("BUFR"));
        console.log(reader.decode(bufr).join("\n"));
        break;
    case "3":
        tables = JSON.parse(fs.readFileSync(process.argv[3]));
        reader = new JsWmoBufrReader("json", tables);
        file_name = process.argv[4];
        console.log("FILE", file_name);
        file_data = fs.readFileSync(file_name, "latin1").toString();
        bufr = file_data.slice(file_data.indexOf("BUFR"));
        console.log(JSON.stringify(reader.decode(bufr), null, 1));
        break;
    default:
        console.log(
            "node test.js <test> <table-file> [bufr-file]\n"+
            "Tests:\n"+
            "1: decode build-in sample to text\n"+
            "2: decode file to text\n"+
            "3: decode file to json\n"
        );
}

