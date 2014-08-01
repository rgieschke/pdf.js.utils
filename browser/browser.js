'use strict';

// Simple buffer implementation.
var Buffer = function(size) {
  if (size == null) {
    size = 1024;
  }
  this.array = new Uint8Array(size);
  return this.length = 0;
};

Buffer.prototype = {
  ensureAvailable: function(length) {
    var arrayNew, neededSize, newSize;
    neededSize = this.length + length;
    newSize = this.array.byteLength;
    if (neededSize <= newSize) {
      return;
    }
    while (neededSize > newSize) {
      newSize *= 2;
    }
    arrayNew = new Uint8Array(newSize);
    arrayNew.set(this.getArray(), 0);
    this.array = arrayNew;
  },
  writeArray: function(array) {
    if (array instanceof Buffer) {
      array = array.getArray();
    }
    this.ensureAvailable(array.byteLength);
    this.array.set(array, this.length);
    this.length += array.byteLength;
  },
  writeNumBigEndian: function(num, numBytes) {
    var i, _i, _ref;
    if (numBytes == null) {
      numBytes = 1;
    }
    if (numBytes * 8 > 32) {
      throw new Error("NumBytes is too large.");
    }
    if (num < 0) {
      throw new Error("Num must not be negative.");
    }
    if (num > Math.pow(2, numBytes * 8) - 1) {
      throw new Error("Num is too large.");
    }
    this.ensureAvailable(numBytes);
    for (i = _i = _ref = numBytes - 1; _ref <= 0 ? _i <= 0 : _i >= 0; i = _ref <= 0 ? ++_i : --_i) {
      this.array[this.length++] = (num >>> i * 8) & 0xff;
    }
  },
  writeStringLatin1: function(str) {
    var i, _, _i, _len;
    this.ensureAvailable(str.length);
    for (i = _i = 0, _len = str.length; _i < _len; i = ++_i) {
      _ = str[i];
      this.array[this.length++] = str.charCodeAt(i);
    }
  },
  getByteLength: function() {
    return this.length;
  },
  getArray: function() {
    return this.array.subarray(0, this.length);
  }
};
// End buffer.

var crc32Worker = new Worker("./crc32.worker.js");
var callbacks = {};
var callbackNextId = 1;

crc32Worker.onmessage = function (ev) {
  if (ev.data.callbackId && (ev.data.callbackId in callbacks)) {
    var callback = callbacks[ev.data.callbackId];
    delete callbacks[ev.data.callbackId];
    (callback[0])(ev.data.crc32);
  }
}

function crc32Promise(data) {
  return new Promise(function (resolve, reject) {
    var callbackId = callbackNextId++;
    var obj = { data: data, callbackId: callbackId };
    callbacks[callbackId] = [resolve, reject];
    crc32Worker.postMessage(obj);
  });
}

function writeChunkPromise(buffer, data) {
  // Length field does not include 4-byte chunk-type field.
  buffer.writeNumBigEndian(data.length-4, 4);
  buffer.writeArray(data);
  if (data instanceof Buffer) {
    var array = data.getArray();
  } else {
    var array = data;
  }
  return crc32Promise(array).then(function (crc32) {
    buffer.writeNumBigEndian(crc32, 4);
  });
}

var PNGSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function generatePNG(obj, pdfData) {
  var data = pdfData.subarray(obj.start, obj.end);
  var buffer = new Buffer();
  buffer.writeArray(PNGSignature);

  // Cf. <http://www.w3.org/TR/PNG/#11IHDR>.
  var width = obj.dict.map.Width;
  var height = obj.dict.map.Height;
  var bitDepth = obj.dict.map.BitsPerComponent;

  var colour = 0;
  switch (obj.dict.map.ColorSpace.name) {
    case "DeviceGray":
      colour = 0;
    break;
    case "DeviceRGB":
      colour = 2;
    break;
  }

  var header = new Buffer();
  header.writeStringLatin1("IHDR");
  header.writeNumBigEndian(width, 4);
  header.writeNumBigEndian(height, 4);
  header.writeNumBigEndian(bitDepth, 1);
  header.writeNumBigEndian(colour, 1);
  // The following are fixed for PDF.
  header.writeNumBigEndian(0, 1); // Compression.
  // Should also check obj.dict.map.DecodeParams.map.Predictor
  // is in [10, 11, 12, 13, 14, 15].
  header.writeNumBigEndian(0, 1); // Filter.
  header.writeNumBigEndian(0, 1); // Interlace.

  var end = new Buffer();
  end.writeStringLatin1("IEND");

  var dataBuffer = new Buffer();
  dataBuffer.writeStringLatin1("IDAT");
  dataBuffer.writeArray(data);

  return writeChunkPromise(buffer, header).then(function () {
    return writeChunkPromise(buffer, dataBuffer);
  }).then(function () {
    return writeChunkPromise(buffer, end);
  }).then(function () {
    var blob = new Blob([buffer.getArray()]);
    return URL.createObjectURL(blob);
  });
}

//
// Helper functions.
//

String.prototype.repeat = function (num) {
  return new Array(num + 1).join(this);
};

function getData(url, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.responseType = 'arraybuffer';
  xhr.onload = (function() {
    var data = new Uint8Array(xhr.response || xhr.mozResponseArrayBuffer);
    callback(data);
  }).bind(this);
  xhr.send(null);
}

function parseQueryString(query) {
  var parts = query.split('&');
  var params = {};
  for (var i = 0, ii = parts.length; i < parts.length; ++i) {
    var param = parts[i].split('=');
    var key = param[0];
    var value = param.length > 1 ? param[1] : null;
    params[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return params;
}

function isRef(obj) { return obj.hasOwnProperty("num"); }
function isDict(obj) { return obj.hasOwnProperty("map"); }
function isStream(obj) { return obj.hasOwnProperty("dict"); }
function isArray(obj) { return obj instanceof Array; }
function isName(obj) { return obj.hasOwnProperty("name"); }
function isNum(obj) { return typeof obj === "number"; }
function isBool(obj) { return typeof obj === "boolean"; }
function isString(obj) { return typeof obj === "string"; }

//
// Walking
//

function StreamContents(pdfDocument, stream, ref) {
  this.pdfDocument = pdfDocument;
  this.stream = stream;
  this.ref = ref;
}

function Node(pdfDocument, obj, name, depth, ref) {
  this.pdfDocument = pdfDocument;
  this.obj = obj;
  this.name = name;
  this.depth = depth;
  this.ref = ref;
}

Node.prototype = {
  get children() {
    var depth = this.depth + 1;
    var obj = this.obj;
    var children = [];
    if (isDict(obj) || isStream(obj)) {
      var map;
      if (isDict(obj)) {
        map = obj.map;
      } else {
        map = obj.dict.map;
      }
      for (var key in map) {
        var value = map[key];
        children.push(new Node(this.pdfDocument, value, key, depth));
      }
      if (isStream(obj)) {
        children.push(new Node(this.pdfDocument, new StreamContents(this.pdfDocument, obj, this.ref), 'Contents', depth));
      }
    } else if (isArray(obj)) {
      for (var i = 0, ii = obj.length; i < ii; i++) {
        var value = obj[i];
        children.push(new Node(this.pdfDocument, value, i, depth));
      }
    }
    return children;
  }
};

function createWalker(data, root) {
  if (root && root !== 'trailer') root = { num: parseInt(root.num, 10), gen: parseInt(root.gen, 10) };
  return PDFJS.getDocument(data).then(function (pdfDocument) {
    pdfDocument._browser = { data: data };
    if (!root || root === 'trailer') {
      var rootPromise = pdfDocument.getRawObject('trailer');
    } else {
      var rootPromise = pdfDocument.getRawObject(root);
    }

    function addChildren(node, nodesToVisit) {
      var children = node.children;
      for (var i = children.length - 1; i >= 0; i--) {
        nodesToVisit.push(children[i]);
      }
    }

    function walk(nodesToVisit, visit) {
      function loop() {
        if (nodesToVisit.length) {
          var currentNode = nodesToVisit.pop();
          if (currentNode.depth > 20) {
            throw new Error('Max depth exceeded.');
          }

          if (isRef(currentNode.obj)) {
            var currentNodePromise = pdfDocument.getRawObject(currentNode.obj).then(function (fetched) {
              return new Node(currentNode.pdfDocument, fetched, currentNode.name, currentNode.depth, currentNode.obj);
            });
          } else {
            var currentNodePromise = Promise.resolve(currentNode);
          }

          return currentNodePromise.then(function (currentNode) {
            var visitChildren = visit(currentNode, function (currentNode, visit) {
              walk(currentNode.children.reverse(), visit);
            }.bind(null, currentNode));

            if (visitChildren) {
              addChildren(currentNode, nodesToVisit);
            }
          }).then(loop);
        }
      }
      return loop();
    }

    return rootPromise.then(function (rootRes) {
      return {
        start: function (visit) {
          var node;
          if (!root || root === 'trailer') {
            node = [new Node(pdfDocument, rootRes, 'Trailer', 0)];
          } else {
            node = [new Node(pdfDocument, rootRes, '', 0, root)];
          }
          walk(node, visit);
        }
      };
    });
  });
}

//
// Tree decoration.
//

function toText(node) {
  var name = node.name;
  var obj = node.obj;
  var description = '';
  if (isDict(obj)) {
    description = name + ' (dict)';
  } else if (isArray(obj)) {
    description = name + ' (array)';
  } else if (isStream(obj)) {
    description = name + ' (stream)';
  } else if (isName(obj)) {
    description = name + ' = /' + obj.name;
  } else if (isNum(obj)) {
    description = name + ' = ' + obj;
  } else if (isBool(obj)) {
    description = name + ' = ' + obj;
  } else if (isString(obj)) {
    description = name + ' = ' + JSON.stringify(obj) + '';
  } else if (obj instanceof StreamContents) {
    description = '<contents>';
  } else {
    console.log(obj);
    throw new Error('Unknown obj');
  }

  if (node.ref) {
    description += ' [id: ' + node.ref.num + ', gen: ' + node.ref.gen + ']';
  }
  return description;
}

function PrettyPrint() {
  this.out = '';
  this.refSet = new RefSet();
}

PrettyPrint.prototype.visit = function (node) {
  var depth = node.depth;
  this.out += ' '.repeat(depth) + toText(node);
  if (node.ref) {
    if (this.refSet.has(node.ref)) {
      return false;
    }
    this.refSet.put(node.ref);
  }
  this.out += '\n';
  return true;
}

function expando(clickEl, li, element, loadCallback) {
  li.classList.add('expando');
  li.appendChild(element);
  var expanded = false;
  var loaded = false;
  clickEl.addEventListener('click', function () {
    expanded = !expanded;
    if (expanded) {
      li.classList.add('expanded');
    } else {
      li.classList.remove('expanded');
    }
    if (!loaded) {
      loadCallback();
      loaded = true;
      return;
    }
  }.bind(this));
}

function HtmlPrint(ul) {
  this.ul = ul;
}

HtmlPrint.prototype.visit = function (ul, node, walk) {
  var obj = node.obj;

  var description = toText(node);

  var li = document.createElement('li');
  var span = document.createElement('span');
  span.textContent = description;
  li.appendChild(span);

  if (isDict(obj) || isStream(obj) || isArray(obj)) {
    var newUl = document.createElement('ul');
    expando(span, li, newUl, function () {
      walk(this.visit.bind(this, newUl));
    }.bind(this));
  } else if (obj instanceof StreamContents) {
    span.textContent = '<view contents> ';
    var pre = document.createElement('pre');
    var a = document.createElement('a');
    a.textContent = 'download';
    var aBytes;
    obj.pdfDocument.getStreamBytes(obj.ref).then(function(bytes) {
      aBytes = bytes;
      a.href = URL.createObjectURL(new Blob([bytes]));
    });
    a.addEventListener('click', function(event) {
      event.stopPropagation();
    });
    span.appendChild(a);

    span.appendChild(document.createTextNode(' '));

    try {
      var a2 = document.createElement('a');
      a2.textContent = 'downloadRaw';
      var a2Array = obj.pdfDocument._browser.data.subarray(obj.stream.start, obj.stream.end);
      var a2Blob = new Blob([a2Array]);
      a2.href = URL.createObjectURL(a2Blob);
      a2.addEventListener('click', function(event) {
        event.stopPropagation();
      });
      span.appendChild(a2);
    } catch (e) {
      console.log(e);
    }

    try {
      if (obj.stream.dict.map.Subtype &&
          obj.stream.dict.map.Subtype.name === 'Image' &&
          obj.stream.dict.map.Filter &&
          obj.stream.dict.map.Filter.name === 'FlateDecode') {
        console.log("PNG");
        span.appendChild(document.createTextNode(' '));

        var a3 = document.createElement('a');
        a3.textContent = 'downloadGeneratedPNG';
        generatePNG(obj.stream, obj.pdfDocument._browser.data).then(
          function (url) {
            a3.href = url;
          }
        );
        a3.addEventListener('click', function(event) {
          event.stopPropagation();
        });
        span.appendChild(a3);
      }
    } catch (e) {
      console.log(e);
    }

    expando(span, li, pre, function () {
      var string = '';
      for (var i = 0; i < aBytes.length; i++) {
        string += String.fromCharCode(aBytes[i]);
      }
      pre.textContent = string;
    });
  }
  ul.appendChild(li);

  return false;
};

var Browser = {};

function go(data) {
  Browser.data = data;
  var hash = document.location.hash.substring(1);
  var hashParams = parseQueryString(hash);
  var root = null;
  if (hashParams.root) {
    var split = hashParams.root.split(',');
    root = { num: split[0], gen: split[1] };
  }

  createWalker(data, root).then(function (w) {
    var ul = document.getElementById('main');
    if (ul) {
      ul.textContent = '';
    } else {
      ul = document.createElement('ul');
      ul.id = 'main';
      document.body.appendChild(ul);
    }

    var hp = new HtmlPrint(ul);
    w.start(hp.visit.bind(hp, hp.ul));
    // var pp = new PrettyPrint();
    // w.start(pp.visit.bind(pp));
    // console.log(pp.out);

    // Expand first level.
    document.querySelector('.expando > span').click();
  });
}

window.addEventListener('change', function webViewerChange(evt) {
  var files = evt.target.files;
  if (!files || files.length === 0)
    return;

  // Read the local file into a Uint8Array.
  var fileReader = new FileReader();
  fileReader.onload = function webViewerChangeFileReaderOnload(evt) {
    var main = document.querySelector('#main');
    if (main) {
      document.body.removeChild(main);
    }
    var buffer = evt.target.result;
    var uint8Array = new Uint8Array(buffer);

    go(uint8Array);
  };

  var file = files[0];
  fileReader.readAsArrayBuffer(file);

}, true);

window.addEventListener('hashchange', function (evt) {
  go(Browser.data);
});

var params = parseQueryString(document.location.search.substring(1));
if (params.file) {
  getData(params.file, function(data) {
    go(data);
  });
}


