(function() {
	var HEADER, UI, ansiparse, app, async, ejs,
	express, forever, foreverUI, fs, _, pkg, child_process,
	passport, LocalStrategy, utils, log;
	express = require('express');
	async = require('async');
	fs = require('fs');
	forever = require('forever');
	_ = require('underscore');
	ansiparse = require('ansiparse');
	ejs = require('ejs');
	pkg = require('./package.json');
	utils = require("./utils/utils");
	log = require("./utils/logger");
	child_process = require('child_process');
	passport = require('passport');
	LocalStrategy = require('passport-local').Strategy;

	process.on("uncaughtException", function(err) {
		return console.log("Caught exception: " + err);
	});

	foreverUI = (function() {

		function foreverUI() {}

		foreverUI.prototype.findProcessByUID = function(uid, cb) {
			return forever.list("", function(err, processes) {
				if (err) return cb(err, null);
				return cb(null, _.find(processes, function(o) {
					return o.uid === uid;
				}));
			});
		};

		foreverUI.prototype.findProcIndexByUID = function(uid, cb) {
			return forever.list("", function(err, processes) {
				var i;
				if ((err) || !(processes)) return cb(err, null);
				i = -1;
				while (processes[++i]) {
					if (processes[i].uid === uid) return cb(null, i);
				}
				return cb("Process '" + uid + "' not found", null);
			});
		};

		foreverUI.prototype.info = function(uid, cb) {
			return this.findProcessByUID(uid, function(err, proc) {
				if (err) return cb(err, null);
				if (!proc) return cb("Undefined proc", null);
				return async.map([proc.logFile, proc.outFile, proc.errFile].filter(function(s) {
					return s !== void 0;
				}), function(filename, cb) {
					return fs.readFile(filename, function(err, data) {
						var d;
						d = (data || '').toString().trim();
						if (!d || d === '\n') {
							return cb(null, [filename, 'Empty log']);
						} else {
							return cb(null, [filename, ansiparse(d)]);
						}
					});
				}, function(err, results) {
					return cb(err, results);
				});
			});
		};

		foreverUI.prototype.update = function(uid, cb) {
			return this.findProcessByUID(uid, function(err, proc) {
				if (err) return cb(err, null);

				// cwd for commands to execute
				var path = proc.file.substring(0, proc.file.lastIndexOf("/") + 1);

				// command list with file dependency for command to be executed
				var commands = [{
					id: 'git',
					dependency: '.git',
					command: 'git pull'
				}, {
					id: 'npm',
					dependency: 'package.json',
					command: 'npm install'
				}, {
					id: 'bower',
					dependency: 'bower.json',
					command: 'bower install'
				}];

				// map commands to functions for asyc
				var commandFuncs = _.map(commands, function(command) {
					return function(cb) {
						if (!fs.existsSync(path + command.dependency)) return cb(null, false);

						child_process.exec(command.command, {
							cwd: path
						}, function(error, stdout, stderr) {
							if (error) return cb(error, null);
							return cb(null, true);
						});
					}
				});

				async.series(commandFuncs, cb);
			});
		};

		foreverUI.prototype.stop = function(uid, cb) {
			return this.findProcIndexByUID(uid, function(err, index) {
				if (err) return cb(err, null);
				return forever.stop(index).on('stop', function(res) {
					return cb(null, true);
				}).on('error', function(err) {
					return cb(err, null);
				});
			});
		};

		foreverUI.prototype.restart = function(uid, cb) {
			return this.findProcIndexByUID(uid, function(err, index) {
				if (err) return cb(err, null);
				return forever.restart(index).on('restart', function(res) {
					return cb(null, true);
				}).on('error', function(err) {
					return cb(err, null);
				});
			});
		};

		foreverUI.prototype.start = function(options, cb) {
			var startScriptParams = [];
			startScriptParams = decodeURIComponent(options).split(" ");
			Array.prototype.unshift.apply(startScriptParams, ["start"]);
			child = child_process.spawn("forever", startScriptParams);
			child.unref();
			return cb(null, this.child);
		};

		return foreverUI;

	})();

	HEADER = {
		'Content-Type': 'text/javascript'
	};

	/*var users = [
		{ id: 1, username: 'joe', password: 'secret', email: 'joe@console.com' },
		{ id: 2, username: 'bob', password: 'birthday', email: 'bob@console.com' }
	];*/
	// create a 'users.js' file that exports an array matching the above array structure
	var users = require('./users');

	function findById(id, fn) {
		var idx = id - 1;
		if (users[idx]) {
			fn(null, users[idx]);
		} else {
			fn(new Error('User ' + id + ' does not exist'));
		}
	}

	function findByUsername(username, fn) {
		for (var i = 0, len = users.length; i < len; i++) {
			var user = users[i];
			if (user.username === username) {
				return fn(null, user);
			}
		}
		return fn(null, null);
	}

	passport.serializeUser(function(user, done) {
		done(null, user.id);
	});

	passport.deserializeUser(function(id, done) {
		findById(id, function (err, user) {
			done(err, user);
		});
	});

	passport.use(new LocalStrategy(
		function(username, password, done) {
			process.nextTick(function () {
				findByUsername(username, function(err, user) {
					if (err) { return done(err); }
					if (!user) { return done(null, false, { message: 'Unknown user ' + username }); }
					if (user.password != password) { return done(null, false, { message: 'Invalid password' }); }
					return done(null, user);
				});
			});
		}
	));

	UI = new foreverUI();
	this.log = new log.Logger();
	exports.forever = forever;
	exports.UI = UI;
	app = express();

	app.configure(function () {
		app.engine('html', ejs.renderFile);
		app.set('views', __dirname + '/views');
		app.use(express.static(__dirname + '/public'));

		express.logger.format('customLog', utils.customLog);
		app.use(express.bodyParser());
		app.use(express.cookieParser());
		app.use(express.methodOverride());
		app.use(express.logger('customLog'));
		app.use(express.session({ secret: 'c0ns0l3F0r3v3r' }));
		app.use(passport.initialize());
		app.use(passport.session());
		app.use(app.router);
	});

	app.configure("development", function() {
		app.use(express.errorHandler({
			dumpExceptions: true,
			showStack: true
		}));
	});

	app.configure("production", function() {
		app.use(express.errorHandler());
	});

	app.set('view options', {
		layout: false
	});

	function commonResponse (req, res) {
		return function(err, results) {
			if (err) {
				return res.send(JSON.stringify({
					status: 'error',
					details: err
				}), HEADER, 500);
			} else {
				return res.send(JSON.stringify({
					status: 'success',
					details: results
				}), HEADER, 200);
			}
		};
	}

	app.get('/console', ensureAuthenticated, function(req, res) {
		return forever.list("", function(err, results) {
			return res.render('index.ejs', {
				process: results,
				version: pkg.version
			});
		});
	});

	app.get('/refresh/', ensureAuthenticated, function(req, res) {
		return forever.list("", function(err, results) {
			return res.send(JSON.stringify(results), HEADER, 200);
		});
	});

	app.get('/processes', ensureAuthenticated, function(req, res) {
		return forever.list("", function(err, results) {
			return res.send(JSON.stringify(results), HEADER, 200);
		});
	});

	app.get('/restart/:uid', ensureAuthenticated, function(req, res) {
		return UI.restart(req.params.uid, commonResponse(req, res));
	});

	app.get('/stop/:uid', ensureAuthenticated, function(req, res) {
		return UI.stop(req.params.uid, commonResponse(req, res));
	});

	app.get('/info/:uid', ensureAuthenticated, function(req, res) {
		return UI.info(req.params.uid, commonResponse(req, res));
	});

	app.get('/update/:uid', ensureAuthenticated, function(req, res) {
		return UI.update(req.params.uid, commonResponse(req, res));
	});

	app.post('/addProcess', ensureAuthenticated, function(req, res) {
		return UI.start(req.body.args, commonResponse(req, res));
	});

	app.get('/', ensureAuthenticated, function(req, res) {
		return res.redirect('/console');
	});

	app.post('/login', passport.authenticate('local', {
		successRedirect: '/console',
		failureRedirect: '/'
	}));

	app.get('/logout', function(req, res){
		req.logout();
		res.redirect('/');
	});

	app.get('*', ensureAuthenticated, function(req, res) {
		return res.redirect('/console');
	});

	function ensureAuthenticated(req, res, next) {
		if (req.isAuthenticated()) {
			return next();
		} else {
			res.render('login.ejs');
		}
	}

	app.listen(8085);

	this.log.info("Started: Forever web Console");
	this.log.info("Server listening on Port: 8085");

}).call(this);
