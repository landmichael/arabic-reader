"use strict";
const bodyParser = require("body-parser");
const express = require('express');
const hbs = require('hbs');
const Matcher = require('./lib/Matcher');
const Notifier = require('./lib/Notifier');
const ContentStore = require('./lib/ContentStore');
const utils = require('./lib/utils');

var app = express();
app.set('view engine', 'hbs');
app.use(bodyParser.urlencoded({
    extended: false
}));
app.use(bodyParser.json());
app.use('/assets', express.static('assets'));
app.use('/', express.static('assets'));
app.listen(3000);

const DELIMS = /([\s\u2000-\u20ff\u0020-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007f\u0600-\u061f\u06d4-\u06de])/g;
const ARABIC = /^([\u0600-\u06ff .,\/\\]+)$/g;

app.get('/', function (req, res) {
    return processPost(req, res);
});

app.post('/', function (req, res) {
    return processPost(req, res);
});

app.get('/content/:filename', function (req, res) {
    return processFile(req, res, req.params.filename);
});

app.get('/search', function (req, res) {
    return processSearch(req, res, req.query.q);
});

app.get('/dups', function (req, res) {
    return processDuplicates(req, res, req.query.q);
});

app.get('/refresh', function (req, res) {
    processRefresh(req, res);
    res.sendStatus(200);
    return;
});

app.post('/add', function (req, res) {
    return processAdd(req, res);
});

app.post('/update', function (req, res) {
    return processUpdate(req, res);
});

app.post('/delete', function (req, res) {
    return processDelete(req, res);
});

function processPost(req, res) {
    var content = req.body.content;
    if (content) {
        var filename = ContentStore.store(content);
        res.redirect('/content/' + filename);
    } else
        res.render('index');
}

function processFile(req, res, filename) {
    var content = ContentStore.retrieve(filename);
    if (content == null) {
        res.send('Content ID ' + filename + ' is not found').sendStatus(404);
        return;
    }
    var result = processContent(req, res, content, filename);
    res.render('index', result);
}

function processContent(req, res, content, filename) {
    var defs = {};
    if (content) {
        content = utils.fixContent(content);
        defs = new Array();
        var tokens = content.split(DELIMS);
        for (var i = 0; i < tokens.length; i++) {
            var token = tokens[i];
            if (token !== "") {
                if (!token.match(DELIMS)) {
                    var def = Matcher.match(token);
                    defs.push(def);
                } else {
                    defs.push({
                        word: token,
                        match: true,
                        exactMatch: true,
                        delim: true
                    });
                }
            }
        }
    }
    return {
        content: content,
        filename: filename,
        words: defs
    };
}

function processSearch(req, res, q) {
    var results = new Array();
    if (q && q != "" && !q.match(/^\s$/) && q.length > 1) {
        var _q = utils.normalizeArabic(utils.stripBasicArabicDiacritics(q.toLowerCase()));
        for (var i = 0; i < Matcher.DICTS.length; i++) {
            var subresults = Matcher.DICTS[i].search(_q);
            for (var j = 0; j < subresults.length; j++)
                utils.pushUniqueObject(results, "id", subresults[j].id, subresults[j]);
        }
    }
    res.render('search.hbs', {
        q: q,
        results: results
    });
}

function processDuplicates(req, res) {
    var results = new Array();
    for (var i = 0; i < Matcher.DICTS.length; i++) {
        var subresults = Matcher.DICTS[i].getDuplicates();
        for (var j = 0; j < subresults.length; j++)
            utils.pushUniqueObject(results, "id", subresults[j].id, subresults[j]);
    }
    res.render('dups.hbs', {
        results: results
    });
}

async function processAdd(req, res) {
    var errors = new Array();
    var pos = req.body.pos;
    var word = req.body.word;
    var past = req.body.past;
    var pres = req.body.pres;
    var def = req.body.def;
    if (!pos || pos.trim() == '')
        errors.push("Part of Speech cannot be blank");
    if (pos && !pos.match(/^(stop|verb|word)$/))
        errors.push("Invalid part of speech");
    if (pos && pos == 'verb') {
        if (!past || past.trim() == '')
            errors.push("Past tense cannot be blank");
        if (!pres || pres.trim() == '')
            errors.push("Present tense cannot be blank");
        if (past && !past.match(ARABIC))
            errors.push("Past tense must in Arabic");
        if (pres && !pres.match(ARABIC))
            errors.push("Present tense must in Arabic");
        if (pres && !pres.startsWith('ي'))
            errors.push("Present tense must start with ي");
    } else {
        if (!word || word.trim() == '')
            errors.push("Word cannot be blank");
        if (word && !word.match(ARABIC))
            errors.push("Word must in Arabic");
    }
    if (!def || def.trim() == '')
        errors.push("Definition cannot be blank");

    pos = pos.trim();
    def = def.trim();
    if (word)
        word = word.trim();
    if (pres)
        pres = pres.trim();
    if (past)
        past = past.trim();
    if (errors.length == 0) {
        try {
            if (pos == 'verb')
                Matcher.addVerb(pos, past, pres, def);
            else
                Matcher.addWord(pos, word, def);
        } catch (e) {
            Notifier.notifyOnError('Unable to add new word', e).catch(console.error);
            errors.push(e);
        }
    }

    if (errors.length > 0) {
        res.render('search.hbs', {
            errors: errors
        });
    } else {
        res.render('search.hbs', {
            q: def,
            success: 'New word successfully added'
        });
    }
}

function processUpdate(req, res) {
    var id = req.body.id;
    var terms0 = req.body.terms0.trim();
    var terms1 = req.body.terms1.trim();
    var def = req.body.def.trim();
    try {
        Matcher.updateWord(id, terms0, terms1, def);
        res.status(200).send('ID ' + id + ' updated');
    } catch (e) {
        Notifier.notifyOnError('Unable to update word', e).catch(console.error);
        res.status(403).send(e);
    }
}

function processDelete(req, res) {
    var id = req.body.id;
    var terms0 = req.body.terms0.trim();
    var terms1 = req.body.terms1.trim();
    try {
        Matcher.deleteWord(id, terms0, terms1);
        res.status(200).send('ID ' + id + ' deleted');
    } catch (e) {
        Notifier.notifyOnError('Unable to delete word', e).catch(console.error);
        res.status(403).send(e);
    }
}

function processRefresh(req, res) {
    Matcher.refreshAllDicts();
}

hbs.registerHelper('islinefeed', function (value) {
    return (value == '\n');
});

hbs.registerHelper('eq', function (value1, value2) {
    return value1 == value2;
});

hbs.registerHelper('trunc', function (value, n) {
    return value.substr(0, n);
});