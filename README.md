# node-brother-label-printer

A node.js library to print labels on a Brother label printer using the [Internet Printing Protocol (IPP)](https://en.wikipedia.org/wiki/Internet_Printing_Protocol).

**Please note:** This library is considered a proof-of-concept and is neither actively maintained nor further developed.

## How to print a PNG file

First, you will need the IP address of your printer. The port for IPP is usually `631` and the path is usually `/ipp/print`. Please refer to your printer's manual for further information. Next, you will need a PNG file to print. Currently, PNG is the only file format supported by this library.

```javascript
const brother = require('../index.js');
const printerUrl = 'http://192.168.178.71:631/ipp/print';

brother.printPngFile(printerUrl, './name-tag-small.png', {landscape: false});
```

See the [samples](./samples/) folder for further details.

## Considerations

Since this library is based on IPP it needs (raw, i.e. TCP) network access. This limitation implies that you cannot use this library in a web browser, where Javascript can only do HTTP/WebSocket requests. You can use this library on the server-side or in an [ElectronJS](https://www.electronjs.org/) desktop application.
