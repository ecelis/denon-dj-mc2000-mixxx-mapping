/**
 * Denon MC2000 controller script for Mixxx v1.11.0
 *
 * Written by Esteban Serrano Roloff.
 * 
 * 2014/03/2 V0.6.2 :	Functional & relatively untested version.
 *			Bug where play control would	become unresponsive after pressing hotcues fixed.
 *
 * Inspired by
 * Bertrand Espern's Denon MC3000 controller script V0.995, and
 * Borfo's Korg Nanocontrol2 controller script V2.2.
 *
 **/

function mc2000(){};

// ----------   Global variables    ----------

// MIDI Reception commands (from spec)
mc2000.leds = {
	shiftlock: 		2,
	vinylmode: 		6,
	keylock: 		8,
	sync: 			9,

	cue1: 			17,
	cue2: 			19,
	cue3: 			21,
	cue4: 			23,

	samp1_l: 		25,
	samp2_l: 		27,
	samp3_l: 		29,
	samp4_l: 		32,

	samples_l: 		35,
	samp1_r: 		65,
	samp2_r: 		67,
	samp3_r: 		69,

	samp4_r: 		71,
	samples_r: 		73,
	cue: 			38,
	play: 			39, // was wrong in the spec sheet as decimal value

	loopin: 		36, 
	loopout: 		64, 
	autoloop: 		43,
	fx1_1: 			92, 
	
	fx1_2: 			93, 
	fx1_3: 			94,
	fx2_1: 			96, 
	fx2_2: 			97,

	fx2_3: 			98,
	// "ALL SLIDER/VOLUME/FADER REQUEST": 57,
	monitorcue_l: 	69,
	monitorcue_r: 	81
};

mc2000.state = {"shift": false, "shiftlock": false};
mc2000.control2CueNo = { 0x17: 1, 0x18: 2, 0x19: 3, 0x20: 4 };


// ----------   Functions    ----------

// Called when the MIDI device is opened & set up.
mc2000.init = function(id, debug) {	

	mc2000.id = id;
	mc2000.debug = debug;


	// ---- Connect controls -----------

	// ---- Controls for Channel 1 and 2
	var i=0;
	for (i=1; i<=2; i++) {

		// Key lock
		engine.connectControl("[Channel"+i+"]", "keylock", "mc2000.keylockSetLed");
		// Sync
		engine.connectControl("[Channel"+i+"]", "beat_active", "mc2000.beatActiveSetLed");

		// Cue 1-4
		var j=0;
		for (j=1;j<=4;j++) {
			engine.connectControl("[Channel"+i+"]","hotcue_"+j+"_enabled","mc2000.hotcueSetLed");
		}

		// Cue
		engine.connectControl("[Channel"+i+"]", "cue_default", "mc2000.cueSetLed");
		// Play
		engine.connectControl("[Channel"+i+"]", "play", "mc2000.playSetLed");

		// Loop in
		engine.connectControl("[Channel"+i+"]", "loop_start_position", "mc2000.loopStartSetLed");
		// Loop out
		engine.connectControl("[Channel"+i+"]", "loop_end_position", "mc2000.loopEndSetLed");
		// Auto loop (actually reloop/exit)
		engine.connectControl("[Channel"+i+"]", "loop_enabled", "mc2000.loopEnableSetLed");

		// FX 1-3
		engine.connectControl("[Channel"+i+"]", "beatloop_2_enabled", "mc2000.beatLoopXSetLed");
		engine.connectControl("[Channel"+i+"]", "beatloop_4_enabled", "mc2000.beatLoopXSetLed");
		engine.connectControl("[Channel"+i+"]", "beatloop_8_enabled", "mc2000.beatLoopXSetLed");

		// Monitor cue
		engine.connectControl("[Channel"+i+"]", "pfl", "mc2000.pflSetLed");
	
	}

	// ---- Controls for Samplers
	// Samples 1-4 (Left)
	for (i=1; i<=4; i++) {
		engine.connectControl("[Sampler"+i+"]","play","mc2000.sampleXSetLed");
	}
	// TODO: Samples 1-4 (Right)


	// Put all LEDs on default state.
	mc2000.allLed2Default();
};

// Called when the MIDI device is closed
mc2000.shutdown = function(id) {
	// Put all LEDs on default state.
	mc2000.allLed2Default();
};




// === FOR MANAGING LEDS ===

mc2000.allLed2Default = function () {
	// All leds OFF for deck 1 and 2
	for (var led in mc2000.leds) {
		mc2000.setLed(1,mc2000.leds[led],0);
		mc2000.setLed(2,mc2000.leds[led],0);	
	}

	// Monitor cue leds OFF for deck 1 and 2 (use function setLed2)
	mc2000.setLed2(1,mc2000.leds["monitorcue_l"],0);
	mc2000.setLed2(2,mc2000.leds["monitorcue_r"],0);

	// Vinylmode ON
	mc2000.setLed(1,mc2000.leds["vinylmode"],1);
	mc2000.setLed(2,mc2000.leds["vinylmode"],1);
};


mc2000.setLed = function(deck,led,status) {
	var ledStatus = 0x4B; // Default OFF
	switch (status) {
		case 0: 	ledStatus = 0x4B; break; // OFF
		case false: ledStatus = 0x4B; break; // OFF 
    	case 1: 	ledStatus = 0x4A; break; // ON
		case true: 	ledStatus = 0x4A; break; // ON
    	case 2: 	ledStatus = 0x4C; break; // BLINK
    	default: 	break;
	}
	midi.sendShortMsg(0xB0+(deck-1), ledStatus, led);
};

mc2000.setLed2 = function(deck,led,status) {
	midi.sendShortMsg(0xB0+(deck-1), status==1 ? 0x50 : 0x51, led);
};




// === MISC COMMON ===

mc2000.group2Deck = function(group) {
	var matches = group.match(/^\[Channel(\d+)\]$/);
	if (matches == null) {
		return -1;
	} else {
		return matches[1];
	}
};

mc2000.loop2NoEfx = function(nbloop) {
	if (nbloop==1) nbloop=16;
	return Math.log(nbloop)/Math.log(2); //2 4 8 16 -> 1 2 3 4	
};



// === GENERAL ===
mc2000.shift = function(channel, control, value, status, group) {
	// Declare shift pressed if button is down.
	mc2000.state["shift"] = (status === 0x90);

	// Change LED states if action is possible
	mc2000.triggerAllSampleReplayControls();
	mc2000.triggerAllHotcueControls();

};

mc2000.triggerAllSampleReplayControls = function(){
	var sampNo=0;
	for (sampNo=1; sampNo<=4; sampNo++)
	{
		engine.trigger("[Sampler"+sampNo+"]","play");
	}
};


mc2000.triggerAllHotcueControls = function(){
	// Channels 1-2
	var ch=0;
	for (ch=1; ch<=2; ch++) {
		// Cue 1-4
		var cueNo=0;
		for (cueNo=1;cueNo<=4;cueNo++) {
			engine.trigger("[Channel"+ch+"]","hotcue_"+cueNo+"_enabled");
		}
	}	
};


// === PLAYLIST ===
mc2000.selectKnob = function(channel, control, value, status, group) {
	// NORMAL MODE - NEXT/PREV TRACK
	if (value == 0x01) {
		engine.setValue(group, "SelectNextTrack", 1);
	} else {
		engine.setValue(group, "SelectPrevTrack", 1);
	}
};



// === PLAYBACK ===
mc2000.bendUpOrFf = function(channel, control, value, status, group) {

	if ((status & 0xF0)===0x90){ // If button down

		if (mc2000.state["shift"] === true) {
			// Fast-forward if shift is pressed too
			// TODO: Change for a VDJ-like FF (jump 4 beats)
			engine.setValue(group, "fwd", true);
		}else{
			// Bend up
			engine.setValue(group, "rate_temp_up", true);
		}	
	}
	else{ // Button up
		engine.setValue(group, "fwd", false);
		engine.setValue(group, "rate_temp_up", false);
	}
	
};

mc2000.bendDnOrRew = function(channel, control, value, status, group) {

	if ((status & 0xF0)===0x90){ // If button down

		if (mc2000.state["shift"] === true) {
			// Fast-rewind if shift is pressed too
			// TODO: Change for a VDJ-like REW (jump 4 beats)
			engine.setValue(group, "back", true);
		}else{
			// Bend down
			engine.setValue(group, "rate_temp_down", true);
		}	
	}
	else{ // Button up
		engine.setValue(group, "back", false);
		engine.setValue(group, "rate_temp_down", false);
	}
};


mc2000.replayOrStopSample = function(channel, control, value, status, group) {
	if ((status & 0xF0) === 0x90) {    // If button down
		if (mc2000.state["shift"] === true) {
			// If shift is pressed, stop
			engine.setValue(group, "start_stop", true);
		}else{
			// Play from start
			engine.setValue(group, "start_play", true);
		}
	}
};

mc2000.beatsKnobTurn = function(channel, control, value, status, group) {
	// Knob turning direction
	var fwd = false;
	if (value === 0x01){
		fwd = true;
	}
	
	// Different action if shift down
	if (mc2000.state["shift"] === true) {
		// If shift is pressed, adjust the samplers volume (currently all of them will be updated at the same time)
		var volStep = 1.0/16;

		var sampNo=0;
		for (sampNo=1; sampNo<=4; sampNo++){
			mc2000.stepSampVol(sampNo, fwd, volStep);
		}
	}else{
		// Jump 1 beat forward or backward
		mc2000.beatJump(group, 1, fwd);
	}
};


mc2000.beatJump = function(group, beats, forward){
	var cursample = engine.getValue(group, "playposition") * engine.getValue(group, "track_samples");

	var backseconds = beats * (60 / engine.getValue(group, "bpm"));

	// *2 to compensate for stereo samples
	var backsamples = backseconds*engine.getValue(group, "track_samplerate")*2;
	
	if (forward === true){
		var newpos = cursample + (backsamples);
	}else{
		var newpos = cursample - (backsamples);
	}

	engine.setValue(group, "playposition", newpos/engine.getValue(group, "track_samples"));
};


mc2000.stepSampVol = function(sampNo, fwd, volStep){
	// Get current volume value
	var curVol = engine.getValue("[Sampler"+sampNo+"]","volume");

	// Calculate new value from the current value and step
	if (fwd === true){
		var newVol = curVol + volStep;
	}else{
		var newVol = curVol - volStep;
	}

	// Ensure it is in valid range
	if (newVol > 1.0){
		newVol = 1.0;
	}else if(newVol < 0.0){
		newVol = 0.0;
	}

	// Set new value for volume
	engine.setValue("[Sampler"+sampNo+"]","volume",newVol);

};


// === HOT CUES ===
mc2000.hotcueActivateOrDelete = function(channel, control, value, status, group) {
	var cueNo = mc2000.control2CueNo[control];

	if ((status & 0xF0) === 0x90) {    // If button down
		if (mc2000.state["shift"] === true) {
			// If shift is pressed, delete cue
			engine.setValue(group, "hotcue_"+cueNo+"_clear", true);
		}else{
			// Set or play cue
			engine.setValue(group, "hotcue_"+cueNo+"_activate", true);
		}
	}
	else{
		// Fixes bug described here: https://bugs.launchpad.net/mixxx/+bug/1280694
		engine.setValue(group, "hotcue_"+cueNo+"_activate", false);
	}
};






// === JOG WHEEL ===

// The button that enables/disables scratching
mc2000.wheelTouch = function(channel, control, value, status, group){
	var deck = channel + 1;
	
	if ((status & 0xF0) === 0x90) {    // If button down
        var alpha = 1.0/8;
        var beta = alpha/32;

        var rpm = 150.0;

        if (mc2000.state["shift"] === true) // If shift is pressed, do a fast search
        	rpm = 30.0;

        engine.scratchEnable(deck, 128, rpm, alpha, beta, true);
    }
    else {    // If button up
        engine.scratchDisable(deck);
    }
};


// The wheel that actually controls the scratching
mc2000.wheelTurn = function(channel, control, value, status, group) {
    var deck = channel + 1;

    // See if we're scratching. If not, skip this.
    if (!engine.isScratching(deck)) return; // for 1.11.0 and above

    // B: For a control that centers on 0x40 (64):
    var newValue=(value-64);
 
    // In either case, register the movement
    engine.scratchTick(deck,newValue);
};







// === SET LED FUNCTIONS ===

mc2000.hotcueSetLed = function(value, group, control) {
	// If in shift mode, currently set hotcues should blink,
	// which indicates they can be deleted by pressing the blinking button.
	if (mc2000.state["shift"] === true && value === 1) {
		value = 2;
	}

	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["cue"+control[7]],value);
};

mc2000.pflSetLed = function(value, group) {
	var side = mc2000.group2Deck(group) == 1 ? 'l' : 'r';
	mc2000.setLed2(mc2000.group2Deck(group),mc2000.leds["monitorcue_"+side],value);
};

mc2000.playSetLed = function(value, group) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["play"],value);
};

mc2000.cueSetLed = function(value, group) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["cue"],value);
};

mc2000.keylockSetLed = function(value, group) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["keylock"],value);
};

mc2000.loopStartSetLed = function (value, group) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["loopin"],value == -1 ? false: true);
};

mc2000.loopEndSetLed = function (value, group) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["loopout"],value == -1 ? false: true);
};

mc2000.loopEnableSetLed = function(value, group, control) {
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["autoloop"],value);
};

mc2000.beatLoopXSetLed = function(value, group, control) {
	var deck = mc2000.group2Deck(group);
	var noEfx = mc2000.loop2NoEfx(control[9]);

	// From the spec, all fx leds are in MIDI CH1 range.
	// First parameter is hardcoded.
	mc2000.setLed(1,mc2000.leds["fx"+deck+"_"+noEfx],value);
};

mc2000.sampleXSetLed = function(value, group, control) {
	// Sampler number can be hardcoded since group is e.g. "[Sampler2]", and at most one digit (for now).
	var noSamp = group[8];

	// If in shift mode, currently playing samples should blink,
	// which indicates they can be stopped by pressing the blinking button.
	if (mc2000.state["shift"] === true && value === 1) {
		value = 2;
	}

	// All 4 available samples are on the left deck.
	// This means the first parameter (deck) can be hardcoded,
	// as well as the _l (suffix) on the led array key.
	mc2000.setLed(1,mc2000.leds["samp"+noSamp+"_l"],value);
};

mc2000.beatActiveSetLed = function (value, group){
	mc2000.setLed(mc2000.group2Deck(group),mc2000.leds["sync"],value);
};
