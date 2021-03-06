/* -*- Mode: JS; tab-width: 4; c-basic-offset: 4; indent-tabs-mode: nil -*- */
/*
 *     Copyright 2012 Couchbase, Inc.
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

// http://stackoverflow.com/questions/610406/javascript-equivalent-to-printf-string-format
String.prototype.format = function() {
  var args = arguments;
  return this.replace(/{(\d+)}/g, function(match, number) {
    return typeof args[number] != 'undefined'
      ? args[number]
      : match
    ;
  });
};

var params = require('./params');

// Declare globals first
var driver = require('couchbase');
var handles = [];
params.parse_cliargs();

var max_handles = params.params["count"];

function seriesPosthook(cb) {
    cb.remaining--;
    if (cb.remaining == 0) {
        console.log("Removing %d from global array", cb.id);
        delete handles[cb.id];
    }
}

// A callback function that is called from libcouchbase
// when it encounters a problem without an operation context
//
function errorHandler(errorMessage) {
    console.log("ERROR: [" + errorMessage + "]");
    process.exit(1);
}

function storageHandler(data, error, key, cas) {
    str = "[ID={0}] Store '{1}' : Error: {2}, CAS: {3}".format(
        data[0].id + ":" + data[1],
        key, error, cas);

    console.log(str);
    seriesPosthook(data[0])
}

function getHandler(data, error, key, cas, flags, value) {
    str = "[ID={0}] Get '{1}' => '{2}' (err={3}, cas={4} flags={5})".format(
        data[0].id + ":" + data[1],
        key, value, error, cas, flags
    );
    console.log(str);
    seriesPosthook(data[0]);
}

// Load the driver and create an instance that connects
// to our cluster running at "myserver:8091"

function schedule_operations_positional(cb) {
    cb._opCallStyle('positional');
    
    console.log("Requesting operations for " + cb.id);
    var ops = [
        [ cb.add, "key", "add", 0, undefined, storageHandler],
        [ cb.replace, "key", "replaced", 0, undefined, storageHandler],
        [ cb.set, "key", "set", 0, undefined, storageHandler],
        [ cb.append, "key", "append", 0, undefined, storageHandler],
        [ cb.prepend, "key", "prepend", 0, undefined, storageHandler],
        [ cb.get, "key", 0, getHandler],
        [ cb.arithmetic, "numeric", 42, 0, 0, undefined, getHandler],

        [ cb.delete, "key", undefined,
         function(data, error, key) {
            console.log("id={0}: Custom remove handler for {1} (err={2})".
                        format(data[0].id, key, error));
        }]
    ];

    cb.remaining = 0;

    for (var i = 0; i < ops.length; i++) {

        var fnparams = ops[i];
        var fn = fnparams.shift();
        fnparams.push([cb, fn.name]);
        fn.apply(cb, fnparams);
    }

    cb.remaining = i-1;
}

function schedule_operations_dict(cb) {
    console.log("Requesting operations for " + cb.id);
    cb._opCallStyle('dict');
    
    var ops = [
        [ cb.add, "key", "add", storageHandler],
        [ cb.replace, "key", "replaced", storageHandler],
        [ cb.set, "key", "set", storageHandler],
        [ cb.append, "key", "append", storageHandler],
        [ cb.prepend, "key", "prepend", storageHandler],
        [ cb.get, "key", getHandler],
        [ cb.arithmetic, "numeric", 42, getHandler],

        [ cb.delete, "key",
         function(data, error, key) {
            console.log("id={0}: Custom remove handler for {1} (err={2})".
                        format(data[0].id, key, error));
        }]
    ];

    cb.remaining = 0;

    for (var i = 0; i < ops.length; i++) {

        var fnparams = ops[i];
        var fn = fnparams.shift();

        cbdata = {};
        cbdata['data'] = [cb, fn.name];
        cbdata['exp'] = Math.round(Math.random() * 1000);
        fnparams.push(cbdata);

        try {
            fn.apply(cb, fnparams);
        } catch(err) {
            console.log("Error while executing %s: (%s)", fn.name, err);
        }
    }

    cb.remaining = i-1;
}

var schedfuncs = {
    "dict" : schedule_operations_dict,
    "positional" : schedule_operations_positional
};


for (var i = 0; i < max_handles; i++) {
    
    var cb = new driver.Couchbase(
        params.params["hostname"],
        params.params["username"],
        params.params["password"],
        params.params["bucket"]
    );
    
    cb.id = i + 0;
    var cberr = (function(iter) {
        return function() {
            console.log("Error handler for " + iter);
            errorHandler.apply(this, arguments);
        }
    })(cb.id);
    
    cb.on("error", cberr);
    schedfuncs[params.params['callstyle']](cb);
    console.log("Created new handle " + cb.id);
    handles[i] = cb;
}