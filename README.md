# jswmobufr

*jswmobufr* is a "pure Javascript" decoder for WMO FM94 BUFR messages.

## Author(s)

DWD amaul Jan2023

## Usage

- Import the javascript module `jswmobufr.js`,
- Instantiate the class `JsBufrReader`,
- call the method `decode()`, it returns the decoded data.

## Examples

To show how to use this module see these two files:

- `test_node.js`
  
  For nodejs, run it with `node test_node.js <parameter ...>`.
  
- `test_page.html`
  
  A simple html file including some javascript. To be able to load/incude 
  the **jswmobufr** module, you have to use a http-server. Might be the nodejs 
  module *http-server* (start with `npx http-server`, then go to 
  http://localhost:8080/test_page.html in your browser.

## BUFR-Tables

For any BUFR decoder to work a TDCF table set is needed.

A basic `table.json` with the latest WMO master table is in this project.

To update the table-set and/or include locale tables the Perl script 
`pack_tables.pl` can be used to re-format ECMWF tables into the required 
JSON format.

For further information on BUFR and the use of tables see:

* [ECMWF eccodes](https://software.ecmwf.int/wiki/display/ECC/ecCodes+Home).
* [DWD's OpenData server](https://opendata.dwd.de/weather/lib/bufr/).


## Changes

## To-Do
There are still things to do:

* Implement the remaining obscure operators

