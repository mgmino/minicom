const ReadLine= require('readline');
const SerialPort= require('serialport');
const ByteLength= require('@serialport/parser-byte-length');
const yArgs= require('yargs');
const fileHandle= require('fs');

const argV = yArgs
    .usage('Usage: $0 [-p <port>] [-b <bps>] [-l] [-t <repeats>]')
    .option('f', {
        alias: 'file',
        describe: 'set download filename',
        type: 'string',
    })
    .option('p', {
        alias: 'port',
        describe: 'set serial port device',
		default: '/dev/ttyUSB0',
        type: 'string',
    })
    .option('b', {
        alias: 'baud',
        describe: 'set baud rate (bps)',
		default: 38400,
        type: 'number',
    })
    .option('e', {
        alias: 'echo',
        describe: 'echo typed characters',
        type: 'boolean',
    })
    .option('r', {
        alias: 'ready',
        describe: 'set ready prompt | throttle delay (ms)',
		default: '}',
        type: 'string',
    })
    .option('l', {
        alias: 'list',
        describe: 'list serial ports',
        type: 'boolean',
    })
    .option('q', {
        alias: 'query',
        describe: 'query every x ms',
		default: 0,
        type: 'number',
    })
    .option('pp', {
        alias: 'parity',
        describe: 'parity (even,odd,none)',
		default: 'none',
        type: 'string',
    })
     .option('pb', {
        alias: 'bits',
        describe: 'bits (7/8)',
		default: '8',
        type: 'number',
    })
   .alias('version', 'v')
    .help()
    .alias('help', 'h')
    .argv;
	
// List active serial ports
if (argV.list) {
  console.log('MiniCom: Available Serial Ports');
  SerialPort.list().then(ports => {
    ports.forEach(function(port) {
  	if (port.pnpId !== undefined) {
  	  console.log(port.path, 'ID:', port.pnpId, 'Mfr:', port.manufacturer,
  	    port.serialNumber ? 'serialNumber: ' +port.serialNumber : '',
	    'vendorId:', port.vendorId, 'productId:', port.productId);
//		console.log(port);
  	}
    });
  });
  return;
}

ReadLine.emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);

// create and open serial port
const chan= new SerialPort(argV.port, { baudRate: argV.baud, dataBits: argV.bits, parity: argV.parity }, (err) => {
    if (err) {
      console.log('MiniCom error on open: ', err.message);
	  process.exit();
    }
  });
const parser= chan.pipe(new ByteLength({length: 1}))

chan.on('open', () => {
  console.log('MiniCom: serial port open at ' +chan.baudRate +' baud @ ' +chan.path);
});

chan.on('close', () => {
  console.log('MiniCom: serial port closed');
});

//ReadLine.on('close', () => {
//    console.log('MiniCom: console closed');
//    process.exit(0);
//});

// Write serial data
function sendSerial(char) {
	chan.write(char, (err) => {
		if (err) return console.log('MiniCom error on char write: ', err.message);
	});
}

// Write serial command line
function sendLine(line, echo= true) {
	if (echo && argV.echo) process.stdout.write(line);
  	chan.write(line +'\r', (err) => {
  		if (err) return console.log('MiniCom error on line write: ', err.message);
  	});
}

function dec2b62(tim) { // convert decimal to base62
	if (tim < 10) return tim +48; // convert to ASCII 0 to 9
	else if (tim < 36) return tim +55; // convert to ASCII A to Z
	return tim +61; // convert to ASCII a to z
}

// Read serial data
const logFile= fileHandle.createWriteStream('log.txt', { flags: 'a' });
let scriptLines= [];
let datum= null;
let queryInActive= true;
parser.on('data', char => {
  if (char == '\x02') datum= ' '; // STX start of text
  else if (char == '\x03') { // ETX end of text
	  let clk= new Date();
	  let timeStamp= String.fromCharCode(dec2b62(clk.getHours()), dec2b62(clk.getMinutes()), dec2b62(clk.getSeconds()));
	  logFile.write(timeStamp +datum +'\n');
	  datum= null;
	  if (argV.query) setTimeout(() => {
		  // fetch data
		  queryInActive= false;
		  sendLine('fet', false);
	  }, argV.query); //send fetch in query ms
  }
  else if (datum != null) datum+= char; // char between STX and ETX
  else if (queryInActive) process.stdout.write(char);
  if (char == argV.ready) {
	  queryInActive= true;
	  if (scriptLines.length) sendLine(scriptLines.shift());
  }
});


// Menu
let menuActive= false;
let itemNotSelected, menuEntree, cmdLine, queryReps;
let fileName= cmdLast= '';
function menu(keyName, key) {
  if (keyName == 'menu') {
    process.stdout.write('Minicom: Filename, Query, Line_mode, Download, Baud set');
	menuActive= true;
	itemNotSelected= true;
	return;
  }
  if (itemNotSelected) menuEntree= keyName;
  if (menuEntree == 'd') { //download
    if (itemNotSelected) {
	  process.stdout.write('; download script section:');
	  itemNotSelected= false;  
	} else {
	  itemNotSelected= true;
	  download(keyName);
	}
  }
  else if (menuEntree == 'l') { //line mode
	let char;
    if (itemNotSelected) {
	  process.stdout.write('; line mode: ');
	  cmdLine= '';
	  itemNotSelected= false;  
	} else if (keyName == 'return') { //send command
		for (char of cmdLine) sendSerial(char);
		sendSerial('\r');
		cmdLast= cmdLine;
		cmdLine= '';
	} else if (keyName == 'backspace' || (keyName == 'left')) { //delete last character
		cmdLine= cmdLine.slice(0, -1);
		process.stdout.write('\x7F');
	} else if (keyName == 'up') { //retrieve last command
		cmdLine= cmdLast;
		process.stdout.write(cmdLine);
	} else if (keyName == 'escape') { //exit line mode
	    process.stdout.write('; end line mode: ');
		itemNotSelected= true;
	} else {
		cmdLine+= key;
		process.stdout.write(key);
	}
  }
  else if (menuEntree == 'q') { //query mode
	let char;
    if (itemNotSelected) {
	  process.stdout.write('; query mode (ms): ');
	  queryReps= '';
	  itemNotSelected= false;  
	} else if (keyName == 'return') { //send command
		argV.query= (queryReps == '') ? 0 : parseInt(queryReps);
		process.stdout.write(`; query every ${argV.query} ms`);
		itemNotSelected= true;
	} else if (keyName == 'backspace') { //delete last character
		queryReps= queryReps.slice(0, -1);
		process.stdout.write('\x7F');
	} else {
		queryReps+= key;
		process.stdout.write(key);
	}
  }
  else if (menuEntree == 'r') { //reset dtr
    if (itemNotSelected) {
	  process.stdout.write('; set dtr >');
	  itemNotSelected= false;  
	} else {
	  itemNotSelected= true;
	  let setting= keyName == '0' ? false : true;
	  chan.set( {DTR: setting}, (err) => {
		if (err) {
		  return console.log('Error on dtr set: ', err.message);
		} else process.stdout.write(`; dtr= ${keyName}`);
	  })
	}
  }
  else if (menuEntree == 'b') { //baud rate
    if (itemNotSelected) {
	  process.stdout.write(`; Baud rate [${chan.baudRate}]: a: 38400, b: 9600, c: 300 >`);
	  itemNotSelected= false;  
	} else {
	  itemNotSelected= true;
	  let newBaud;
	  if (keyName == 'a') newBaud= 38400;
	  else if (keyName == 'b') newBaud= 9600;
	  else if (keyName == 'c') newBaud= 300;
	  else return;
	  chan.update( {baudRate: newBaud}, (err) => {
		if (err) {
		  return console.log('Error on update options: ', err.message);
		} else process.stdout.write(`; Baud rate changed to [${chan.baudRate}]`);
	  })
	}
  }
  else if (menuEntree == 'f') { //set download file name
    if (itemNotSelected) {
	  process.stdout.write(`; download filename [${argV.file}]: `);
	  itemNotSelected= false;  
	} else if (keyName == 'return') {
		if (fileName != '') argV.file= fileName;
		fileName= '';
		itemNotSelected= true;
	} else {
		fileName+= key;
		process.stdout.write(key);
	}
  }
  else if (menuEntree == 't') test();
  if (itemNotSelected) menuActive= false;
}

// Read stdin
process.stdin.on('keypress', (key, keyInfo) => {
  if (keyInfo.ctrl) {
	  if (keyInfo.name === 'c') {
		  console.log('MiniCom exit via ctrlC');
		  chan.close();
//		  ReadLine.close();
		  process.exit(0);
	  } else if (keyInfo.name === 'x') chan.close();
	  else if (keyInfo.name === 'k') menu('menu');
	  else sendSerial(key);
  } else if (menuActive) menu(keyInfo.name, key);
  else {
    if (key == undefined) key= keyInfo.sequence;
	sendSerial(key);
	if (argV.echo && (keyInfo.name != 'return')) process.stdout.write(key); //echo
  }
});

// Download file to target
function download(keyName) {
  fileHandle.readFile(argV.file, 'utf8' , (err, script) => {
    if (err) {
//    console.error(err)
	  console.log('Minicom: ', err.message);
      // return
    }
	if (keyName != 'return') {
		const regex= new RegExp(`\\ =${keyName}=`,'m');
		let pos;
		if ((pos= script.search(regex)) != -1) {
			script= script.slice(pos); //backslash truncated
			if ((pos= script.search(/^\\ =/m)) != -1) {
				script= script.slice(0, pos);
			}
			script= '\\' +script; //backslash added
		}
	}
	if ((pos= script.search(/^\\ ===/m)) != -1) script= script.slice(0, pos); //end of script marker
	scriptLines= script.split(/\r?\n/);
	if (isNaN(argV.ready))
		sendSerial('\r'); //trigger the download
	else
		throttle();
  });
}

// schedule background messages
function throttle() {
  scriptLines.shift(); //discard first line
  scriptLines.forEach ((line, index) => {
    setTimeout(() => {
	// Write serial data
  	chan.write(line, (err) => {
  		if (err) {
			return console.log('Error on throttle write: ', err.message);
  		}
		if (argV.echo) console.log(line);
  	});
    }, index*parseInt(argV.ready)); //send line every second
  })
  scriptLines= [];
}

function test() {
	console.log('test script');
}
//voodootikigod/node-serialport
//nexxy/ultra-cinnamon -- AkashaThorne/ultra-cinnamon
