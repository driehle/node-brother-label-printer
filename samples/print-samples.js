const brother = require('../index.js');

(async() => {
    const printerUrl = 'http://192.168.178.71:631/ipp/print';
    await brother.printPngFile(printerUrl, './name-tag-small.png', {landscape: false});
    await brother.printPngFile(printerUrl, './name-tag-large.png', {landscape: true});
})();