const ipp = require('ipp');
const util = require('util');
const fs = require('fs');
const pngparse = require('pngparse');

function wait(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}

async function doPrint(printerUrl, bufferToBePrinted) {
    const printer = ipp.Printer(printerUrl);
    const execute = util.promisify(printer.execute.bind(printer));
    const printerStatus = await execute('Get-Printer-Attributes', null);

    if (printerStatus['printer-attributes-tag']['printer-state'] === 'idle') {
        // printer ready to work
        const res = await execute(
            'Print-Job',
            {
                'operation-attributes-tag': {
                    'requesting-user-name': 'mobile',
                    'job-name': 'label',
                    'document-format': 'application/octet-stream',
                },
                'job-attributes-tag': {
                    copies: 1,
                    sides: 'one-sided',
                    'orientation-requested': 'landscape',
                },
                data: bufferToBePrinted,
            },
        );

        if (res.statusCode === 'successful-ok' ||
            res.statusCode === 'successful-ok-ignored-or-substituted-attributes') 
        {
            const jobId = res['job-attributes-tag']['job-id'];
            let tries = 0;
            let job;
            
            await wait(500);
            while (tries <= 50) {
                tries += 1;

                // eslint-disable-next-line no-await-in-loop
                job = await execute(
                    'Get-Job-Attributes',
                    { 'operation-attributes-tag': { 'job-id': jobId } },
                );
                
                if (job && job['job-attributes-tag']['job-state'] === 'completed') {
                    return job;
                }

                // eslint-disable-next-line no-await-in-loop
                await wait(1000);
            }

            await execute('Cancel-Job', {
                'operation-attributes-tag': {
                    // "job-uri":jobUri,  //uncomment this
                    //* /
                    'printer-uri': printer.uri, // or uncomment this two lines - one of variants should work!!!
                    'job-id': job['job-attributes-tag']['job-id'],
                    //* /
                },
            });

            console.log(`Job with id ${job['job-attributes-tag']['job-id']}is being canceled`);
            throw new Error('Job is canceled - too many tries and job is not printed!');
        } else {
            console.log(res);
            throw new Error('Error sending job to printer!');
        }
    } else {
        throw new Error(`Printer ${printerStatus['printer-attributes-tag']['printer-name']} is not ready!`);
    }
};

function convertToBlackAndWhiteMatrixImage(image, options) {
    // convert image to matrix of pixels:
    let rows = [];

    for (let y = 0; y < image.height; y++) {
        let cols = [];
        for (let x = 0; x < image.width; x++) {
            let pos = x + image.width*y;


            pos = pos * image.channels;
            let pixel = 0; // white = 0, black = 1

            // console.log(image.data[pos], image.data[pos+1], image.data[pos+2], image.data[pos+3]);
            let threshold = options.blackwhiteThreshold;
            let gray;

            // 1 channel : grayscale
            // 2 channels: grayscale + alpha
            // 3 channels: RGB
            // 4 channels: RGBA
            switch(image.channels) {
                case 1:
                    if(image.data[pos] < threshold) pixel = 1;
                    break;

                case 2:
                    gray = image.data[pos] *  image.data[pos+1]/255;
                    if(gray < threshold) pixel = 1;
                    break;

                case 3:
                    gray = 0.21*image.data[pos] + 0.72*image.data[pos+1] + 0.07*image.data[pos+2];
                    if(gray < threshold) pixel = 1;
                    break;

                case 4:
                    gray = (0.21*image.data[pos] + 0.72*image.data[pos+1] + 0.07*image.data[pos+2]) * image.data[pos+3]/255;
                    if(gray < threshold) pixel = 1;
                    break;
            }

            cols.push(pixel);
        }
        rows.push(cols);
    }

    return {
        height: image.height,
        width: image.width,
        data: rows
    };
}

function rotateMatrixImage(bwMatrixImage) {
    let rows = [];
    for (let x = 0; x < bwMatrixImage.width; x++) {
        let cols = [];
        for (let y = bwMatrixImage.height - 1; y >= 0; y--) {
            cols.push(bwMatrixImage.data[y][x]);
        }
        rows.push(cols);
    }

    // noinspection JSSuspiciousNameCombination
    return {
        height: bwMatrixImage.width,
        width: bwMatrixImage.height,
        data: rows
    };
}

function convertImageToDotlabel(bwMatrixImage) {

    // build header data for image
    let data = [
        Buffer.alloc(400),                              // invalidate
        Buffer.from([0x1b, 0x40]),                      // initialize
        Buffer.from([0x1b, 0x69, 0x61, 0x01]),          // switch to raster mode
        Buffer.from([0x1b, 0x69, 0x21, 0x00]),          // status notification
        Buffer.from([0x1b, 0x69, 0x7a, 0x86, 0x0a, 0x3e, 0x00, 0xe0, 0x03, 0x00, 0x00, 0x00, 0x00]), // 62mm continuous
        Buffer.from([0x1b, 0x69, 0x4d, 0x40]),          // select auto cut
        Buffer.from([0x1b, 0x69, 0x41, 0x01]),          // auto cut for each sheet
        Buffer.from([0x1b, 0x69, 0x4b, 0x08]),          // select cut at end
        Buffer.from([0x1b, 0x69, 0x64, 0x23, 0x00]),    // 35 dots margin
        Buffer.from([0x4d, 0x00]),                      // disable compression
    ];

    // iterate over matrix imag
    for (let y = 0; y < bwMatrixImage.height; y++) {
        // each row has 3 bytes for the command and 90 bytes for data
        let rowBuffer = Buffer.alloc(93);

        // command is 0x67 0x00 0x90
        rowBuffer[0] = 0x67;
        rowBuffer[2] = 0x5A; // 90
        for (let x = 0; x < bwMatrixImage.width; x++) {
            if(bwMatrixImage.data[y][x] == 1) {
                // calculate current byte and bit
                let byteNum = 93 - Math.floor(x / 8 + 3);
                let bitOffset = x % 8;
                // write data to buffer (which is currently 0x00-initialized)
                rowBuffer[byteNum] |= (1 << bitOffset);
            }
        }

        data.push(rowBuffer);
    }

    // end label with <ESC> Z:
    data.push(Buffer.from([0x1A]));

    // concat all buffers
    let buf = Buffer.concat(data);
    //console.log(buf.length, "length");
    return buf;
}


async function convert(img, options) {
    // get options
    let defaultOptions = {
        landscape: false,
        blackwhiteThreshold: 128
    };
    if (options == null) options = defaultOptions;
    if (!options.landscape) options.landscape = defaultOptions.landscape;
    if (!options.blackwhiteThreshold) options.blackwhiteThreshold = defaultOptions.blackwhiteThreshold;
    
    // image width cannot be more than 720 pixels
    // can only store 90 bytes in a row with 8 pixels per byte so that's 720 pixels
    if (!options.landscape) {
        if(img.width > 720) throw new Error('Width cannot be more than 720 pixels');
    } else {
        if(img.height > 720) throw new Error('Height cannot be more than 720 pixels');
    }

    // convert to black and white pixel matrix image (pbm style):
    let bwMatrixImage = convertToBlackAndWhiteMatrixImage(img, options);

    // rotate image if landscape mode is requested
    if(options.landscape){
        bwMatrixImage = rotateMatrixImage(bwMatrixImage);
    }

    // convert to 'label image' or something that the label printer understands:
    return convertImageToDotlabel(bwMatrixImage);
}

module.exports = {
    printPngFile: async function(printerUrl, filename, options) {
        // read PNG file
        let parseFile = util.promisify(pngparse.parseFile);
        let img = await parseFile(filename);
        
        let printData = await convert(img, options);
        return await doPrint(printerUrl, printData);
    },
    printPngBuffer: async function (printerUrl, buffer, options) {
        // read PNG buffer
        let parseBuffer = util.promisify(pngparse.parseBuffer);
        let img = await parseBuffer(filename);
        
        let printData = await convert(img, options);
        return await doPrint(printerUrl, printData);
    }
}
