var events = require('events');
var SerialPort = require("serialport").SerialPort;
var Delimiter = SerialPort.parsers.Delimiter;
//
// Class MilightRF24Controller
//

/**
 *
 * @param options
 * @constructor
 */
var MilightRF24Controller = function (options) {
    var self = this;
	options = options || {};
	
	events.EventEmitter.call(this);
	
	this._counter = 0;
	this._lastSend = 0;
	this._packets = new Array();
	this._sending = false;
	this._opened = false;
	
	this._serialPort = new SerialPort(options.port, {
		baudRate: 115200,
		autoOpen: false
	});
	
	this._emitter = new events.EventEmitter();
	
	this._emitter.on("sendData", function () {
		if(self._packets.length > 0){
			var packet = self._packets.shift();
			//console.log(packet);
			self.emit("Sending", packet);
			self._serialPort.write(packet);
			self._serialPort.drain();
			
			setTimeout(function(){
				self._emitter.emit("sendData");
			}, 100);
		}
		else {
			self.emit("Sending", "Queue Finished");
			self._sending = false;
		}
	});

	this._emitter.on("dataReceived", function (data){		
		var stringData = String(data);
		
		if(stringData == "Resending\r\nResending\r\n")
			return;
		
		data = String(data).split(" ");
		var id = ""+data[1]+data[2];
		var group = parseInt(data[4],16).toString(10) & 0x07;
		var button = parseInt(data[5], 16).toString(10) & 0x0F;
		var brightness = null;
		var color = null;
		var disco = null;
		
		color = self._MilightColorToRGB(parseInt(data[3],16).toString(10));
		
		brightness = (parseInt(data[4], 16).toString(10) & 0xF8);	  
		brightness = self._MilightBrightnessToPercent(brightness);
		
		if(button == 0x0D) {
		  	disco = parseInt(data[0],16).toString(10) & 0x0F;
		}
		
		var longPress = false;
		if(parseInt(data[5],16).toString(10) & 0x10) {
			longPress = true;
		}
		
		data[0] =  data[0].replace("\n", "");
		data.pop();
		
		var dataObj = {
			string: stringData,
			raw: data,
			id: id,
			zone: group,
			button: button,
			longPress: longPress,
			discoMode: disco,
			brightness: brightness,
			color: {
				r: color.r,
				g: color.g,
				b: color.b
			}
		};
		
		self.emit("Received", dataObj);
	});

};

MilightRF24Controller.prototype.__proto__ = events.EventEmitter.prototype;

MilightRF24Controller.prototype.open = function () {
	var self = this;
	
	self._serialPort.on("open", function () {
		self._parser = self._serialPort.pipe(new Delimiter({ delimiter: '\r\n', encoding: 'ascii' }))
		self._parser.on('data', function(data) {
			if(data.length == 22) {
				self._emitter.emit("dataReceived", data, self);
			}
		});

		// wait for Arduino init
		setTimeout(function() {
			self._serialPort.write("xr\r\n", function(err, results) {
				self._opened = true;
				self._sendData();
			});
		}, 5000);
	});
}

MilightRF24Controller.prototype.setColor = function (id,zone,r,g,b){
	var self = this;
	
	self._queueData(id, zone, 0, self._numHex(self._hsvToMilightColor(self._rbgToHsv(r,b,g))), "00", "0F", 30);
	//self._queueData(id, zone, 0, self._numHex(self._hsvToMilightColor(self._rbgToHsv(r,b,g))), "00", "00", 30);
}

MilightRF24Controller.prototype.setBrightness =  function (id, zone, percent) {
	var self = this;
	
	var brightness = self._PercentToMilightBrightness(percent);

	self._queueData(id, zone, 0, "00", brightness, "0E", 30);
	//self._queueData(id, zone, 0, "00", brightness, "00", 30);
}

MilightRF24Controller.prototype.sendButton =  function (id, zone, button, longPress) {
	var self = this;
	
	if(longPress == true)
		button = button | 0x10;
	
	self._queueData(id, zone, 0, "00", "00", button, 40);
}

MilightRF24Controller.prototype.sendDiscomode = function (id, zone, discomode) {
	var self = this;
	
	if(discomode < 0 || discomode > 8)
		return;
	
	self._queueData(id, zone, 0, "00", "00", 0x0D, 40);
}

MilightRF24Controller.prototype._sendData = function () {
	var self = this;
	
	if(self._sending === false && self._opened) {
		self._sending = true;
		self._emitter.emit("sendData");
	}
}

MilightRF24Controller.prototype._queueData = function(id, zone, disco, color, brightness, button, repeats) {
	var self = this;
	
	if(self._counter > 255)
		_counter = 0;
	
	if(zone > 4)
		return;
	
	self._counter++;
	
	brightness = brightness | zone;
	
	var strRepeats = "";
	for(var i = 0; i < repeats; i++)
		strRepeats += ".";
	
	var packet = "B"+disco+id+color+self._numHex(brightness)+self._numHex(button)+self._numHex(self._counter)+"\r\n"+strRepeats+"\r\n";
	
	self._packets.push(packet);
	//console.log("Queue: "+packet + "Sending: "+self._sending);
	self._sendData();
}

MilightRF24Controller.prototype._numHex = function (s) {
  var a = s.toString(16);
  if( (a.length % 2) > 0 ){ a = "0" + a; }
  return a;
}

/** Converts a RGB color value to HSV
 * @see http://en.wikipedia.org/wiki/HSL_and_HSV and http://www.rapidtables.com/convert/color/rgb-to-hsv.htm
 * @param r
 * @param g
 * @param b
 * @returns {*{}}
 */
MilightRF24Controller.prototype._rbgToHsv = function (r, g, b) {
    r = r / 255, g = g / 255, b = b / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, v = max;

    var d = max - min;
    s = max == 0 ? 0 : d / max;

    if (max == min) {
        h = 0;
    }
    else {
        switch (max) {
            case r:
                h = ((g - b) / d + (g < b ? 6 : 0));
                break;
            case g:
                h = ((b - r) / d + 2);
                break;
            case b:
                h = ((r - g) / d + 4);
                break;
        }
        h = Math.round(h * 60);
        s = Math.round(s * 100);
        v = Math.round(v * 100);
    }
    //console.log([h,s,v ]);
    return [h, s, v];
};

MilightRF24Controller.prototype._hsvToMilightColor = function (hsv){
    // On the HSV color circle (0..360) with red at 0 degree. We need to convert to the Milight color circle
    // which has 256 values with red at position 26
    var color = (256 + 26 - Math.floor(Number(hsv[0]) / 360.0 * 255.0)) % 256;
    return color;
};

/**
 * HSV to RGB color conversion
 *
 * H runs from 0 to 360 degrees
 * S and V run from 0 to 100
 * 
 * Ported from the excellent java algorithm by Eugene Vishnevsky at:
 * http://www.cs.rit.edu/~ncs/color/t_convert.html
 */
MilightRF24Controller.prototype._hsvToRgb = function(h, s, v) {
    var r, g, b;
    var i;
    var f, p, q, t;

    // Make sure our arguments stay in-range
    h = Math.max(0, Math.min(360, h));
    s = Math.max(0, Math.min(100, s));
    v = Math.max(0, Math.min(100, v));

    // We accept saturation and value arguments from 0 to 100 because that's
    // how Photoshop represents those values. Internally, however, the
    // saturation and value are calculated from a range of 0 to 1. We make
    // That conversion here.
    s /= 100;
    v /= 100;

    if (s == 0) {
        // Achromatic (grey)
        r = g = b = v;
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    h /= 60; // sector 0 to 5
    i = Math.floor(h);
    f = h - i; // factorial part of h
    p = v * (1 - s);
    q = v * (1 - s * f);
    t = v * (1 - s * (1 - f));

    switch (i) {
        case 0:
            r = v;
            g = t;
            b = p;
            break;

        case 1:
            r = q;
            g = v;
            b = p;
            break;

        case 2:
            r = p;
            g = v;
            b = t;
            break;

        case 3:
            r = p;
            g = q;
            b = v;
            break;

        case 4:
            r = t;
            g = p;
            b = v;
            break;

        default:
            // case 5:
            r = v;
            g = p;
            b = q;
    }
	
    return {
			r: Math.round(r * 255) || 0,
			g: Math.round(b * 255) || 0,
			b: Math.round(g * 255) || 0
	}
};

MilightRF24Controller.prototype._MilightColorToRGB  = function(milicolor) {
	var c1 = (Math.floor((milicolor / 255.0 * 359.0) % 360) - 36);
	var color = c1 <= 0 ? Math.abs(c1) : 360 - c1;
	rgb = this._hsvToRgb(color, 100, 100);
	return rgb;
};

MilightRF24Controller.prototype._PercentToMilightBrightness = function(percent) {
	var brightness = Math.max( 0,(Math.round(percent/100*25)));

	var ifBrightness = (brightness -16) * -1;
  
	if(ifBrightness < 24 && ifBrightness >= 0) {
    	brightness = brightness * -1;
		brightness += 16;
	}
	else {
        brightness = brightness * -1;
		brightness += 50;
	}
	
	brightness = brightness << 3
	
	if(brightness > 255)
		brightness = 255;
	
	return brightness;
}

MilightRF24Controller.prototype._MilightBrightnessToPercent =  function(brightness) {

	if(brightness < 0xC8 && brightness > 0xA0)
		brightness = 0xC8;

	brightness = brightness >> 3;
	
	if(brightness < 25) {
        brightness -= 16;
        brightness = brightness * -1;
	}
	else{
		brightness -= 50;
		brightness = brightness * -1;
	}
	
	//brightness = brightness << 3;
	
	return brightness = Math.max(0, Math.min( 100,(Math.ceil(brightness/25*100))));
}

var RGBWButtons = function(){};
RGBWButtons.prototype.AllOn = 0x01;
RGBWButtons.prototype.AllOff = 0x02;
RGBWButtons.prototype.Group1On = 0x03;
RGBWButtons.prototype.Group1Off = 0x04;
RGBWButtons.prototype.Group2On = 0x05;
RGBWButtons.prototype.Group2Off =0x06;
RGBWButtons.prototype.Group3On = 0x07;
RGBWButtons.prototype.Group3Off = 0x08;
RGBWButtons.prototype.Group4On = 0x09;
RGBWButtons.prototype.Group4Off = 0x0A;
RGBWButtons.prototype.SpeedUp = 0x0B;
RGBWButtons.prototype.SpeedDown = 0x0C;
RGBWButtons.prototype.ColorFader = 0x0F;
RGBWButtons.prototype.BrightnessFader = 0x0E;
RGBWButtons.prototype.FaderReleased = 0x00;

module.exports = {
	MilightRF24Controller: MilightRF24Controller,
	RGBWButtons: new RGBWButtons()
}
