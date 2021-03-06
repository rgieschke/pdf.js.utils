// Generated by CoffeeScript 1.4.0
(function() {
  var crc32, heap, heapData, heapTable, initTable, partSizeIn16MB, useAsm;

  partSizeIn16MB = 1;

  asmAvailable = !!(function() {
  "use asm"; function a() {}; return { a: a };
})().a.toString().match(/\[native code\]/);;


  useAsm = true && asmAvailable;

  initTable = function(table) {
    var c, k, n, _i, _j, _results;
    _results = [];
    for (n = _i = 0; _i <= 255; n = ++_i) {
      c = n;
      for (k = _j = 0; _j <= 7; k = ++_j) {
        if (c & 1) {
          c = 0xedb88320 ^ (c >>> 1);
        } else {
          c = c >>> 1;
        }
      }
      _results.push(table[n] = c);
    }
    return _results;
  };

  if (useAsm) {
    heap = new ArrayBuffer(16 * 1024 * 1024 * (partSizeIn16MB + 1));
    heapData = new Int8Array(heap, 0, 16 * 1024 * 1024 * partSizeIn16MB);
    heapTable = new Int32Array(heap, 16 * 1024 * 1024 * partSizeIn16MB);
    initTable(heapTable);
    
  updateCrc32 = (function(stdlib, foreign, heap) {
    "use asm";

    var HEAP8 = new stdlib.Int8Array(heap);
    var HEAP32 = new stdlib.Int32Array(heap);

    function updateCrc32(crc, length, table) {
      crc = crc | 0;
      length = length | 0;
      table = table | 0;
      var i = 0;
      for (; (i|0) < (length|0); i = i+1|0) {
        crc = HEAP32[(((crc ^ HEAP8[i]) & 0xff) + table) << 2 >> 2] ^ (crc >>> 8);
      }
      return crc | 0;
    }

    return { updateCrc32: updateCrc32 };

  })(self, null, heap).updateCrc32;
  ;

  }

  crc32 = (function() {
    var table;
    table = new Int32Array(256);
    initTable(table);
    return function(array, crc, useAsmNow) {
      if (crc == null) {
        crc = 0;
      }
      if (useAsmNow == null) {
        useAsmNow = useAsm;
      }
      crc = crc ^ 0xffffffff;
      if (useAsmNow && array.length <= 16 * 1024 * 1024 * partSizeIn16MB) {
        heapData.set(array);
        crc = updateCrc32(crc, array.length, 16 * 1024 * 1024 * partSizeIn16MB / 4);
      } else {
        
      for (var i = 0, ii = array.length; i < ii; i++) {
        crc = table[(crc ^ array[i]) & 0xff] ^ (crc >>> 8);
      }
      ;

      }
      return (crc ^ 0xffffffff) >>> 0;
    };
  })();

  self.onmessage = function(ev) {
    var array, blob, crc, data, maxSize, part, reader, start, transfer, useAsmNow, _i, _ref;
    crc = 0;
    reader = new FileReaderSync();
    useAsmNow = useAsm;
    transfer = [];
    data = ev.data.data;
    if (data instanceof Blob) {
      blob = data;
      if (blob.size < 100 * 1024 * 1024) {
        useAsmNow = false;
      }
      maxSize = 16 * 1024 * 1024 * partSizeIn16MB;
      for (start = _i = 0, _ref = blob.size; 0 <= _ref ? _i <= _ref : _i >= _ref; start = _i += maxSize) {
        part = reader.readAsArrayBuffer(blob.slice(start, start + maxSize));
        crc = crc32(new Int8Array(part), crc, useAsmNow);
      }
    } else {
      array = null;
      if (data.buffer instanceof ArrayBuffer) {
        transfer = [data.buffer];
        array = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
      if (data instanceof ArrayBuffer) {
        transfer = [data];
        array = new Uint8Array(data);
      }
      if (data instanceof Array) {
        array = new Uint8Array(data);
      }
      if (array.length < 100 * 1024 * 1024) {
        useAsmNow = false;
      }
      crc = crc32(array, crc, useAsmNow);
    }
    ev.data.crc32 = crc;
    ev.data.useAsm = useAsmNow;
    return self.postMessage(ev.data, transfer);
  };

}).call(this);
