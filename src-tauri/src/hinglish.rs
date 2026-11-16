//! Hindi in Roman letters ("Hinglish"), the way people type it: Devanagari → "main kal meeting
//! mein bataunga ki deck ready hai". Used by meeting notes when Whisper wrote a Hindi sentence in
//! Devanagari and the Hinglish model (`hinglish-apex`) isn't downloaded, and to score transcripts
//! against Romanized references (`norm_word`, spelling variants folded together).
//!
//! The rules are Hinglish conventions, not a scholarly transliteration (no diacritics):
//! - common words have their usual spelling ("मैं" main, "में" mein, "है" hai, "नहीं" nahi, "यह" yeh)
//! - English words Whisper wrote in Devanagari come back as English ("मीटिंग" meeting, "इनवॉइस" invoice)
//! - the inherent "a" is dropped at the end of a word and in the middle where Hindi drops it
//!   ("कमरा" kamra, "समझना" samajhna, "सबको" sabko), but kept in "मित्र" mitra
//! - long vowels are written short except where people double them ("बात" baat, "आज" aaj, "ठीक"
//!   theek), nasals become n (or m before p/b/m)

/// Does the text contain Devanagari letters?
pub fn has_devanagari(s: &str) -> bool {
    s.chars().any(is_deva)
}

fn is_deva(c: char) -> bool {
    ('\u{0900}'..='\u{097F}').contains(&c)
}

/// Common words with a fixed Hinglish spelling the letter rules wouldn't produce.
const WORDS: &[(&str, &str)] = &[
    ("मैं", "main"), ("में", "mein"), ("मे", "mein"), ("है", "hai"), ("हैं", "hain"), ("हे", "hai"), ("नहीं", "nahi"), ("नही", "nahi"),
    ("यह", "yeh"), ("वह", "woh"), ("ये", "ye"), ("वो", "wo"), ("हूँ", "hoon"), ("हूं", "hoon"), ("हु", "hoon"), ("क्या", "kya"),
    ("क्यों", "kyun"), ("क्यूँ", "kyun"), ("क्यूं", "kyun"), ("तो", "toh"), ("और", "aur"), ("भी", "bhi"), ("कि", "ki"), ("की", "ki"),
    ("एक", "ek"), ("आप", "aap"), ("अच्छा", "accha"), ("अच्छी", "acchi"), ("अच्छे", "acche"), ("ठीक", "theek"), ("हाँ", "haan"),
    ("हां", "haan"), ("कहाँ", "kahan"), ("कहां", "kahan"), ("यहाँ", "yahan"), ("यहां", "yahan"), ("वहाँ", "wahan"), ("वहां", "wahan"),
    ("मुझे", "mujhe"), ("तुम्हें", "tumhe"), ("उन्हें", "unhe"), ("इन्हें", "inhe"), ("हमें", "hume"), ("तुझे", "tujhe"), ("कुछ", "kuch"),
    ("अभी", "abhi"), ("कभी", "kabhi"), ("सभी", "sabhi"), ("लेकिन", "lekin"), ("क्योंकि", "kyunki"), ("इसलिए", "isliye"),
    ("चाहिए", "chahiye"), ("बहुत", "bahut"), ("थोड़ा", "thoda"), ("थोड़ी", "thodi"), ("ज़्यादा", "zyada"), ("ज्यादा", "zyada"),
    ("ज़रूर", "zaroor"), ("जरूर", "zaroor"), ("शायद", "shayad"), ("पहले", "pehle"), ("बाद", "baad"), ("साथ", "saath"), ("पास", "paas"),
    ("लिए", "liye"), ("वाला", "wala"), ("वाली", "wali"), ("वाले", "wale"), ("गई", "gayi"), ("गयी", "gayi"), ("हुआ", "hua"),
    ("हुई", "hui"), ("हुए", "hue"), ("करूँगा", "karunga"), ("करूंगा", "karunga"), ("करूँगी", "karungi"), ("करूंगी", "karungi"),
    ("बताऊँगा", "bataunga"), ("बताऊंगा", "bataunga"), ("बताऊँगी", "bataungi"), ("बताऊंगी", "bataungi"), ("भेजूँगा", "bhejunga"),
    ("भेजूंगा", "bhejunga"), ("जाऊँगा", "jaunga"), ("जाऊंगा", "jaunga"), ("आऊँगा", "aaunga"), ("आऊंगा", "aaunga"), ("दूँगा", "dunga"),
    ("दूंगा", "dunga"), ("लूँगा", "lunga"), ("लूंगा", "lunga"), ("हम", "hum"), ("तुम", "tum"), ("कैसे", "kaise"), ("कैसा", "kaisa"),
    ("कैसी", "kaisi"), ("ऐसे", "aise"), ("ऐसा", "aisa"), ("वैसे", "waise"), ("जैसे", "jaise"), ("भाई", "bhai"), ("कोई", "koi"),
    ("जी", "ji"), ("न", "na"), ("ना", "na"), ("पे", "pe"), ("ने", "ne"), ("सुबह", "subah"), ("शाम", "shaam"), ("रात", "raat"),
    ("आज", "aaj"), ("परसों", "parson"), ("यार", "yaar"), ("हमारा", "hamara"), ("हमारी", "hamari"), ("हमारे", "hamare"),
    ("तुम्हारा", "tumhara"), ("तुम्हारी", "tumhari"), ("तुम्हारे", "tumhare"), ("उसका", "uska"), ("उसकी", "uski"), ("उसके", "uske"),
    ("इसका", "iska"), ("इसकी", "iski"), ("इसके", "iske"), ("उनका", "unka"), ("उनकी", "unki"), ("उनके", "unke"), ("सिर्फ़", "sirf"),
    ("सिर्फ", "sirf"), ("फिर", "phir"), ("फ़िर", "phir"), ("बिल्कुल", "bilkul"), ("ज़रा", "zara"), ("जरा", "zara"), ("मत", "mat"),
    ("रहूँगा", "rahunga"), ("रहूंगा", "rahunga"), ("चलो", "chalo"), ("चलिए", "chaliye"), ("दीजिए", "dijiye"), ("कीजिए", "kijiye"),
    ("लीजिए", "lijiye"), ("बोलिए", "boliye"), ("बताइए", "bataiye"), ("सकते", "sakte"), ("सकता", "sakta"), ("सकती", "sakti"),
    ("पड़ेगा", "padega"), ("पड़ेगी", "padegi"), ("मिलते", "milte"), ("करते", "karte"), ("रखते", "rakhte"), ("होते", "hote"),
    ("दस", "das"), ("नौ", "nau"), ("आठ", "aath"), ("सात", "saat"), ("छह", "chhe"), ("छः", "chhe"), ("पाँच", "paanch"), ("पांच", "paanch"),
    ("चार", "chaar"), ("तीन", "teen"), ("दो", "do"), ("ग्यारह", "gyarah"), ("बारह", "barah"), ("सौ", "sau"), ("हज़ार", "hazaar"),
    ("हजार", "hazaar"), ("लाख", "lakh"), ("करोड़", "crore"), ("मिनट", "minute"), ("घंटे", "ghante"), ("घंटा", "ghanta"),
];

/// English words Whisper writes in Devanagari when people mix them into Hindi.
const LOANWORDS: &[(&str, &str)] = &[
    // the general model's own spellings of the same words (heard in Flo's meeting harness)
    ("रेदी", "ready"), ("फीदबैक", "feedback"), ("फिदबैक", "feedback"), ("फीडबेक", "feedback"), ("फिडबैक", "feedback"), ("टेंशन", "tension"),
    ("टेन्शन", "tension"), ("प्रेजंटेशन", "presentation"), ("प्रिजेंटेशन", "presentation"), ("प्रेज़ंटेशन", "presentation"), ("इनवोइस", "invoice"),
    ("इन्वोइस", "invoice"), ("इनवॉईस", "invoice"), ("बताएंगा", "bataunga"), ("बताएँगा", "bataunga"), ("बताउंगा", "bataunga"), ("बताऊगा", "bataunga"),
    ("मीटिंग", "meeting"), ("मीटिंग्स", "meetings"), ("मिटिंग", "meeting"), ("इनवॉइस", "invoice"), ("इनवॉयस", "invoice"),
    ("इन्वॉइस", "invoice"), ("इनवाइस", "invoice"), ("इनवॉइसेस", "invoices"), ("डेक", "deck"), ("रेडी", "ready"), ("प्रेजेंटेशन", "presentation"),
    ("प्रेज़ेंटेशन", "presentation"), ("प्रज़ेंटेशन", "presentation"), ("प्रजेंटेशन", "presentation"), ("ऑफिस", "office"), ("ऑफ़िस", "office"),
    ("आफिस", "office"), ("टीम", "team"), ("प्रोजेक्ट", "project"), ("क्लाइंट", "client"), ("क्लाइंट्स", "clients"), ("ईमेल", "email"),
    ("ई-मेल", "email"), ("मेल", "mail"), ("फोन", "phone"), ("फ़ोन", "phone"), ("कॉल", "call"), ("काल", "call"), ("अपडेट", "update"),
    ("अपडेट्स", "updates"), ("रिपोर्ट", "report"), ("डेडलाइन", "deadline"), ("बजट", "budget"), ("सेल्स", "sales"), ("मार्केटिंग", "marketing"),
    ("डिज़ाइन", "design"), ("डिजाइन", "design"), ("रिव्यू", "review"), ("प्लान", "plan"), ("प्लानिंग", "planning"), ("टाइम", "time"),
    ("ओके", "okay"), ("ओक", "okay"), ("थैंक्स", "thanks"), ("थैंक्यू", "thank you"), ("प्लीज़", "please"), ("प्लीज", "please"),
    ("सॉरी", "sorry"), ("लॉन्च", "launch"), ("प्राइसिंग", "pricing"), ("डैशबोर्ड", "dashboard"), ("कस्टमर", "customer"),
    ("कस्टमर्स", "customers"), ("फीडबैक", "feedback"), ("फ़ीडबैक", "feedback"), ("कॉन्ट्रैक्ट", "contract"), ("वीकेंड", "weekend"),
    ("मंडे", "Monday"), ("ट्यूज़डे", "Tuesday"), ("ट्यूसडे", "Tuesday"), ("वेडनेसडे", "Wednesday"), ("थर्सडे", "Thursday"),
    ("फ्राइडे", "Friday"), ("फ़्राइडे", "Friday"), ("सैटरडे", "Saturday"), ("संडे", "Sunday"), ("लैपटॉप", "laptop"), ("सर", "sir"),
    ("मैडम", "madam"), ("बॉस", "boss"), ("डेटा", "data"), ("डाटा", "data"), ("सर्वर", "server"), ("ऐप", "app"), ("वेबसाइट", "website"),
    ("लिंक", "link"), ("शेयर", "share"), ("स्लाइड", "slide"), ("स्लाइड्स", "slides"), ("फाइल", "file"), ("फ़ाइल", "file"),
    ("डॉक्यूमेंट", "document"), ("अप्रूवल", "approval"), ("अप्रूव", "approve"), ("बग", "bug"), ("फिक्स", "fix"), ("टेस्ट", "test"),
    ("टेस्टिंग", "testing"), ("रिलीज़", "release"), ("रिलीज", "release"), ("डेमो", "demo"), ("नंबर", "number"), ("नंबर्स", "numbers"),
    ("टारगेट", "target"), ("प्रोडक्ट", "product"), ("फीचर", "feature"), ("फीचर्स", "features"), ("यूज़र", "user"), ("यूजर", "user"),
    ("यूज़र्स", "users"), ("कोड", "code"), ("मैनेजर", "manager"), ("प्रॉब्लम", "problem"), ("प्राब्लम", "problem"), ("इशू", "issue"),
    ("इश्यू", "issue"), ("सॉल्व", "solve"), ("चेक", "check"), ("कन्फर्म", "confirm"), ("कंफर्म", "confirm"), ("कैंसल", "cancel"),
    ("शेड्यूल", "schedule"), ("ब्रेक", "break"), ("लंच", "lunch"), ("क्वार्टर", "quarter"), ("ग्रोथ", "growth"), ("रेवेन्यू", "revenue"),
    ("पर्सेंट", "percent"), ("परसेंट", "percent"), ("प्रतिशत", "pratishat"), ("बिल", "bill"), ("पेमेंट", "payment"), ("अकाउंट", "account"),
    ("बैंक", "bank"), ("ऑनलाइन", "online"), ("ऑफलाइन", "offline"), ("इंटरव्यू", "interview"), ("जॉब", "job"), ("सैलरी", "salary"),
    ("ट्रेनिंग", "training"), ("सेशन", "session"), ("वर्क", "work"), ("होम", "home"), ("फ्रॉम", "from"), ("एक्चुअली", "actually"),
    ("बेसिकली", "basically"), ("राइट", "right"), ("नेक्स्ट", "next"), ("लास्ट", "last"), ("वीक", "week"), ("मंथ", "month"),
    ("डेट", "date"), ("ग्रेट", "great"), ("गुड", "good"), ("नाइस", "nice"), ("डन", "done"), ("फाइनल", "final"), ("फ़ाइनल", "final"),
    ("ड्राफ्ट", "draft"), ("ग्रुप", "group"), ("चैनल", "channel"), ("स्लैक", "Slack"), ("ज़ूम", "Zoom"), ("गूगल", "Google"),
    ("एक्सेल", "Excel"), ("शीट", "sheet"), ("पीपीटी", "PPT"), ("डिस्कस", "discuss"), ("डिस्कशन", "discussion"), ("फॉलो", "follow"),
    ("अप", "up"), ("सेंड", "send"), ("रूम", "room"), ("बुक", "book"), ("एनालिटिक्स", "analytics"), ("कन्वर्ज़न", "conversion"),
    ("कन्वर्जन", "conversion"), ("रेट", "rate"), ("समरी", "summary"), ("एजेंडा", "agenda"), ("स्टेटस", "status"), ("प्रोग्रेस", "progress"),
    ("सपोर्ट", "support"), ("सिस्टम", "system"), ("सॉफ्टवेयर", "software"), ("बैकएंड", "backend"), ("फ्रंटएंड", "frontend"),
    ("डेवलपर", "developer"), ("इंजीनियर", "engineer"), ("कंपनी", "company"), ("बिज़नेस", "business"), ("बिजनेस", "business"),
    ("मार्केट", "market"), ("स्टार्टअप", "startup"), ("इन्वेस्टर", "investor"), ("फंडिंग", "funding"), ("पिच", "pitch"), ("डील", "deal"),
    ("ऑफर", "offer"), ("ऑर्डर", "order"), ("डिलीवरी", "delivery"), ("स्टॉक", "stock"), ("सप्लाई", "supply"), ("वेंडर", "vendor"),
    ("एचआर", "HR"), ("सीईओ", "CEO"), ("ओनली", "only"), ("अगेन", "again"), ("टुडे", "today"), ("टुमॉरो", "tomorrow"), ("टुमारो", "tomorrow"),
];

fn lookup(table: &[(&str, &'static str)], w: &str) -> Option<&'static str> {
    let w = fold_nukta(w);
    table.iter().find(|(d, _)| fold_nukta(d) == w).map(|(_, r)| *r)
}

/// Consonant + nukta → the precomposed letter (Whisper writes either form).
fn fold_nukta(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c == '\u{093C}' {
            if let Some(p) = out.pop() {
                let q = with_nukta(p);
                out.push(q);
                if q == p {
                    out.push(c);
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Vowel {
    /// the inherent "a" of a consonant
    Inherent,
    /// the inherent "a", dropped (schwa deletion)
    Dropped,
    /// virama: no vowel, the next consonant joins the cluster
    Halant,
    AA,
    I,
    II,
    U,
    UU,
    RI,
    E,
    AI,
    O,
    AU,
    /// ॉ (the "o" of "office")
    CandraO,
    /// ॅ
    CandraE,
}

impl Vowel {
    fn sounds(self) -> bool {
        !matches!(self, Vowel::Dropped | Vowel::Halant)
    }
}

#[derive(Debug, Clone)]
struct Syl {
    /// consonants of the cluster (Devanagari, nukta folded in)
    cons: Vec<char>,
    vowel: Vowel,
    /// anusvara / chandrabindu
    nasal: bool,
    visarga: bool,
}

fn consonant(c: char) -> Option<char> {
    match c {
        '\u{0915}'..='\u{0939}' | '\u{0958}'..='\u{095F}' | '\u{0979}'..='\u{097F}' => Some(c),
        _ => None,
    }
}

/// A consonant with nukta → its precomposed form (क + ़ → क़).
fn with_nukta(c: char) -> char {
    match c {
        'क' => '\u{0958}',
        'ख' => '\u{0959}',
        'ग' => '\u{095A}',
        'ज' => '\u{095B}',
        'ड' => '\u{095C}',
        'ढ' => '\u{095D}',
        'फ' => '\u{095E}',
        'य' => '\u{095F}',
        _ => c,
    }
}

fn matra(c: char) -> Option<Vowel> {
    Some(match c {
        'ा' => Vowel::AA,
        'ि' => Vowel::I,
        'ी' => Vowel::II,
        'ु' => Vowel::U,
        'ू' => Vowel::UU,
        'ृ' | 'ॄ' => Vowel::RI,
        'ॅ' => Vowel::CandraE,
        'ॆ' | 'े' => Vowel::E,
        'ै' => Vowel::AI,
        'ॉ' => Vowel::CandraO,
        'ॊ' | 'ो' => Vowel::O,
        'ौ' => Vowel::AU,
        _ => return None,
    })
}

fn independent(c: char) -> Option<Vowel> {
    Some(match c {
        'अ' => Vowel::Inherent,
        'आ' => Vowel::AA,
        'इ' => Vowel::I,
        'ई' => Vowel::II,
        'उ' => Vowel::U,
        'ऊ' => Vowel::UU,
        'ऋ' | 'ॠ' => Vowel::RI,
        'ऍ' => Vowel::CandraE,
        'ऎ' | 'ए' => Vowel::E,
        'ऐ' => Vowel::AI,
        'ऑ' => Vowel::CandraO,
        'ऒ' | 'ओ' => Vowel::O,
        'औ' => Vowel::AU,
        _ => return None,
    })
}

fn cons_roman(c: char) -> &'static str {
    match c {
        'क' | '\u{0958}' => "k",
        'ख' | '\u{0959}' => "kh",
        'ग' | '\u{095A}' => "g",
        'घ' => "gh",
        'ङ' | 'ञ' | 'ण' | 'न' | 'ऩ' => "n",
        'च' => "ch",
        'छ' => "ch",
        'ज' => "j",
        '\u{095B}' => "z",
        'झ' => "jh",
        'ट' => "t",
        'ठ' => "th",
        'ड' | '\u{095C}' => "d",
        'ढ' | '\u{095D}' => "dh",
        'त' => "t",
        'थ' => "th",
        'द' => "d",
        'ध' => "dh",
        'प' => "p",
        'फ' => "ph",
        '\u{095E}' => "f",
        'ब' => "b",
        'भ' => "bh",
        'म' => "m",
        'य' | '\u{095F}' => "y",
        'र' | 'ऱ' => "r",
        'ल' | 'ळ' | 'ऴ' => "l",
        'व' => "v",
        'श' | 'ष' => "sh",
        'स' => "s",
        'ह' => "h",
        _ => "",
    }
}

fn parse(word: &str) -> Vec<Syl> {
    let mut out: Vec<Syl> = vec![];
    let mut join = false;
    let mut chars = word.chars().peekable();
    while let Some(c) = chars.next() {
        if let Some(k) = consonant(c) {
            let k = if chars.peek() == Some(&'\u{093C}') {
                chars.next();
                with_nukta(k)
            } else {
                k
            };
            match out.last_mut() {
                Some(s) if join => {
                    s.cons.push(k);
                    s.vowel = Vowel::Inherent;
                }
                _ => out.push(Syl { cons: vec![k], vowel: Vowel::Inherent, nasal: false, visarga: false }),
            }
            join = false;
        } else if c == '\u{094D}' {
            if let Some(s) = out.last_mut() {
                s.vowel = Vowel::Halant;
                join = true;
            }
        } else if let Some(v) = matra(c) {
            if let Some(s) = out.last_mut() {
                s.vowel = v;
            }
            join = false;
        } else if let Some(v) = independent(c) {
            out.push(Syl { cons: vec![], vowel: v, nasal: false, visarga: false });
            join = false;
        } else if c == 'ं' || c == 'ँ' {
            if let Some(s) = out.last_mut() {
                s.nasal = true;
            }
        } else if c == 'ः' {
            if let Some(s) = out.last_mut() {
                s.visarga = true;
            }
        }
        // anything else (ZWJ, avagraha) adds no sound
    }
    out
}

/// Hindi drops the inherent "a" at the end of a word and between a vowel and a consonant that is
/// followed by a vowel (VC_CV), scanning from the right; never in the first syllable.
fn delete_schwas(s: &mut [Syl]) {
    let n = s.len();
    if n >= 2 {
        let last = &mut s[n - 1];
        // "मित्र" mitra, "राज्य" rajya keep it after a cluster ending in r / y; "दोस्त" dost doesn't
        let keeps = last.cons.len() > 1 && matches!(last.cons.last(), Some('र' | 'य'));
        if last.vowel == Vowel::Inherent && !last.cons.is_empty() && !last.nasal && !keeps {
            last.vowel = Vowel::Dropped;
        }
    }
    if n >= 3 {
        for i in (1..n - 1).rev() {
            let next_ok = s[i + 1].vowel.sounds() && s[i + 1].cons.len() == 1;
            // not after a syllable closed by a nasal: "ज़िंदगी" zindagi, not "zindgi"
            let prev_ok = s[i - 1].vowel.sounds() && !s[i - 1].nasal && !s[i - 1].visarga;
            if s[i].vowel == Vowel::Inherent && s[i].cons.len() == 1 && !s[i].nasal && !s[i].visarga && prev_ok && next_ok {
                s[i].vowel = Vowel::Dropped;
            }
        }
    }
}

fn cluster_roman(cons: &[char]) -> String {
    if cons == ['ज', 'ञ'] {
        return "gy".into();
    }
    let mut out = String::new();
    let mut prev = "";
    for &c in cons {
        let r = cons_roman(c);
        // a doubled aspirate is written once with the plain letter first: च्छ "cch", क्ख "kkh"
        if r == prev && r.len() > 1 {
            out.truncate(out.len() - r.len());
            out.push_str(&r[..1]);
        }
        out.push_str(r);
        prev = r;
    }
    out
}

/// Devanagari word → Roman letters by rule (after `delete_schwas`).
fn render(s: &[Syl]) -> String {
    let voiced: Vec<usize> = (0..s.len()).filter(|&i| s[i].vowel.sounds()).collect();
    // a word with one vowel that ends in a consonant or nasal: people double its long vowel
    // ("baat", "kaam", "theek", "doodh")
    let closed_mono = voiced.len() == 1 && (voiced[0] + 1 < s.len() || s[voiced[0]].nasal || s[voiced[0]].vowel == Vowel::Halant);
    let mut out = String::new();
    for (i, syl) in s.iter().enumerate() {
        let after_vowel = i > 0 && syl.cons.is_empty() && s[i - 1].vowel.sounds();
        let prev_v = if i > 0 { s[i - 1].vowel } else { Vowel::Halant };
        let mut cl = cluster_roman(&syl.cons);
        // व: "wala", "woh", "hawa" as people write them, "v" elsewhere ("vikas", "seva")
        if syl.cons == ['व'] && matches!(syl.vowel, Vowel::Inherent | Vowel::AA | Vowel::E | Vowel::O | Vowel::Dropped) && (i == 0 || matches!(prev_v, Vowel::Inherent | Vowel::AA)) {
            cl = "w".into();
        }
        out.push_str(&cl);
        let initial = i == 0 && syl.cons.is_empty();
        let v = match syl.vowel {
            Vowel::Inherent => "a",
            Vowel::Dropped | Vowel::Halant => "",
            Vowel::AA if initial || closed_mono => "aa",
            Vowel::AA => "a",
            Vowel::I => "i",
            Vowel::II if closed_mono => "ee",
            Vowel::II => "i",
            Vowel::U => "u",
            Vowel::UU if closed_mono => "oo",
            Vowel::UU => "u",
            Vowel::RI => "ri",
            Vowel::E if after_vowel && matches!(prev_v, Vowel::Inherent | Vowel::AA | Vowel::I | Vowel::II) => "ye",
            Vowel::E => "e",
            Vowel::AI => "ai",
            Vowel::O | Vowel::CandraO => "o",
            Vowel::AU => "au",
            Vowel::CandraE => "e",
        };
        out.push_str(v);
        if syl.nasal {
            let next_labial = s.get(i + 1).and_then(|n| n.cons.first()).is_some_and(|c| matches!(c, 'प' | 'फ' | 'ब' | 'भ' | 'म'));
            let last = i + 1 == s.len();
            if last && syl.vowel == Vowel::E {
                // "करें" karein, "जाएँ" jaayein
                out.push_str("in");
            } else {
                out.push(if next_labial { 'm' } else { 'n' });
            }
        }
        if syl.visarga {
            out.push('h');
        }
    }
    out
}

fn digit(c: char) -> Option<char> {
    match c {
        '\u{0966}'..='\u{096F}' => char::from_u32(c as u32 - 0x0966 + '0' as u32),
        _ => None,
    }
}

/// One whitespace-separated token: Devanagari letters → Roman, punctuation and Latin kept.
fn token(tok: &str) -> String {
    if !has_devanagari(tok) {
        return tok.to_string();
    }
    let mut out = String::new();
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        if word.is_empty() {
            return;
        }
        let w = std::mem::take(word);
        let r = lookup(WORDS, &w).or_else(|| lookup(LOANWORDS, &w)).map(String::from).unwrap_or_else(|| {
            let mut s = parse(&w);
            delete_schwas(&mut s);
            render(&s)
        });
        out.push_str(&r);
    };
    for c in tok.chars() {
        if c == '\u{200C}' || c == '\u{200D}' {
            continue;
        }
        if is_deva(c) && !matches!(c, '।' | '॥' | '\u{0966}'..='\u{096F}') {
            word.push(c);
            continue;
        }
        flush(&mut word, &mut out);
        match c {
            '।' | '॥' => out.push('.'),
            _ => out.push(digit(c).unwrap_or(c)),
        }
    }
    flush(&mut word, &mut out);
    out
}

/// Hindi in Devanagari → Hinglish in Roman letters. Words already in Latin script (English that
/// Whisper kept as is) pass through; sentences start with a capital letter.
pub fn to_roman(text: &str) -> String {
    if !has_devanagari(text) {
        return text.to_string();
    }
    let joined = text.split_whitespace().map(token).filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ");
    // a danda written after a space ("है ।") leaves " ."
    let joined = joined.replace(" .", ".").replace(" ?", "?").replace(" ,", ",");
    capitalize_sentences(&joined)
}

fn capitalize_sentences(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut start = true;
    for c in s.chars() {
        if start && c.is_alphabetic() {
            out.extend(c.to_uppercase());
            start = false;
        } else {
            out.push(c);
            if matches!(c, '.' | '?' | '!') {
                start = true;
            } else if !c.is_whitespace() && !matches!(c, '"' | '\'' | '(' | '“') {
                start = false;
            }
        }
    }
    out
}

/// Spellings of the same Hinglish word that differ only by convention ("nahin"/"nahi"/"nhi",
/// "toh"/"to", "accha"/"acha", "theek"/"thik", "woh"/"vo") folded into one form, for comparing a
/// transcript with a reference. Lowercases and strips punctuation.
pub fn norm_word(w: &str) -> String {
    let w: String = w.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect();
    if w.is_empty() {
        return w;
    }
    let w = match w.as_str() {
        "me" | "mei" | "mai" | "men" | "mein" => "mein".to_string(),
        "nahin" | "nhi" | "nai" | "nahi" => "nahi".to_string(),
        "he" | "h" | "hai" | "hae" | "hain" | "hein" | "hen" => if w.ends_with('n') { "hain" } else { "hai" }.to_string(),
        "ok" | "okay" | "okk" => "okay".to_string(),
        "hoon" | "hun" | "hu" | "hoo" => "hu".to_string(),
        "ek" | "1" => "ek".to_string(),
        "do" | "2" => "do".to_string(),
        "teen" | "3" => "teen".to_string(),
        "das" | "10" => "das".to_string(),
        _ => w,
    };
    if w.chars().all(|c| c.is_ascii_digit()) {
        return w;
    }
    // letter-level conventions
    let mut s = w.replace("chh", "ch").replace("cch", "ch").replace("ph", "f").replace('w', "v").replace('z', "j").replace('q', "k");
    s = s.replace("aa", "a").replace("ee", "i").replace("oo", "u").replace("ae", "ai");
    // "y" between vowels ("gayi"/"gai", "liye"/"lie")
    let cs: Vec<char> = s.chars().collect();
    let vowel = |c: char| "aeiou".contains(c);
    let mut t = String::new();
    for (i, &c) in cs.iter().enumerate() {
        if c == 'y' && i > 0 && i + 1 < cs.len() && vowel(cs[i - 1]) && vowel(cs[i + 1]) {
            continue;
        }
        t.push(c);
    }
    // doubled consonants ("pakka"/"paka"), a final "h" after a vowel ("toh", "yeh", "subah")
    let mut u = String::new();
    for c in t.chars() {
        if u.ends_with(c) && !vowel(c) {
            continue;
        }
        u.push(c);
    }
    if u.len() > 2 && u.ends_with('h') && u[..u.len() - 1].ends_with(vowel) {
        u.pop();
    }
    u
}

/// Normalized words of a transcript or reference (`norm_word` on each).
pub fn norm_words(s: &str) -> Vec<String> {
    s.split(|c: char| c.is_whitespace() || matches!(c, '-' | '/'))
        .map(norm_word)
        .filter(|w| !w.is_empty())
        .collect()
}

/// Edit distance between two sequences.
pub fn edit_distance<T: PartialEq>(a: &[T], b: &[T]) -> usize {
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, x) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, y) in b.iter().enumerate() {
            cur[j + 1] = (prev[j] + usize::from(x != y)).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        prev = cur;
    }
    prev[b.len()]
}

/// Word error rate of `hyp` against `reference`, Hinglish spellings folded (`norm_words`).
pub fn wer(reference: &str, hyp: &str) -> f64 {
    let (r, h) = (norm_words(reference), norm_words(hyp));
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    edit_distance(&r, &h) as f64 / r.len() as f64
}

/// Character error rate on the normalized words (spaces ignored).
pub fn cer(reference: &str, hyp: &str) -> f64 {
    let r: Vec<char> = norm_words(reference).concat().chars().collect();
    let h: Vec<char> = norm_words(hyp).concat().chars().collect();
    if r.is_empty() {
        return if h.is_empty() { 0.0 } else { 1.0 };
    }
    edit_distance(&r, &h) as f64 / r.len() as f64
}

/// Hindi words that show up in nearly every Hinglish sentence. A Latin-script line for Hindi
/// speech with none of them is a translation into English, not a transcript.
const MARKERS: &[&str] = &[
    "hai", "hain", "ka", "ki", "ke", "ko", "se", "mein", "nahi", "nahin", "kya", "aur", "bhi", "tha", "thi", "raha", "rahi", "rahe", "kar",
    "karna", "diya", "kiya", "gaya", "gayi", "kal", "aaj", "hum", "aap", "mujhe", "yeh", "woh", "dena", "lena", "baje", "sab", "sabko",
    "ghar", "kaam", "abhi", "tak", "ne", "hoon", "bata", "bataunga", "chahiye", "accha", "acha", "theek", "thik", "haan", "liye", "wala",
    "wali", "bhej", "bhejna", "dila", "jana", "pura", "poora", "hogi", "hoga", "hua", "ho", "gaye", "karo", "karte", "kuch", "matlab",
];

/// Does a Latin-script line read as Hinglish (Hindi words in it), not English?
pub fn looks_hinglish(s: &str) -> bool {
    // raw words: folding spellings would make English "to" / "me" read as "toh" / "mein"
    s.split_whitespace().map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect::<String>()).any(|w| MARKERS.contains(&w.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_words_use_hinglish_spelling() {
        assert_eq!(to_roman("मैं"), "Main");
        assert_eq!(to_roman("यह मेरा काम है"), "Yeh mera kaam hai");
        assert_eq!(to_roman("मुझे नहीं पता"), "Mujhe nahi pata");
        assert_eq!(to_roman("घर में हूँ"), "Ghar mein hoon");
    }

    #[test]
    fn english_loanwords_come_back_in_english() {
        assert_eq!(to_roman("कल सुबह दस बजे मीटिंग है, सबको याद दिला देना।"), "Kal subah das baje meeting hai, sabko yaad dila dena.");
        assert_eq!(to_roman("मुझे राहुल को इनवॉइस भेजना है।"), "Mujhe rahul ko invoice bhejna hai.");
        assert_eq!(to_roman("मैं कल मीटिंग में बताऊँगा कि डेक रेडी है"), "Main kal meeting mein bataunga ki deck ready hai");
    }

    #[test]
    fn schwa_is_dropped_where_hindi_drops_it() {
        for (d, r) in [
            ("कमरा", "kamra"),
            ("समझना", "samajhna"),
            ("सबको", "sabko"),
            ("मतलब", "matlab"),
            ("समय", "samay"),
            ("अपना", "apna"),
            ("मिलना", "milna"),
            ("रहना", "rahna"),
            ("बहुत", "bahut"),
            ("घर", "ghar"),
            ("बात", "baat"),
            ("दोस्त", "dost"),
            ("मित्र", "mitra"),
            ("भेजना", "bhejna"),
            ("जनता", "janta"),
        ] {
            assert_eq!(to_roman(d).to_lowercase(), r, "{d}");
        }
    }

    #[test]
    fn nasals_vowels_and_conjuncts() {
        for (d, r) in [
            ("हाँ", "haan"),
            ("संबंध", "sambandh"),
            ("अंदर", "andar"),
            ("करें", "karein"),
            ("गए", "gaye"),
            ("चाहिए", "chahiye"),
            ("बच्चा", "baccha"),
            ("पक्का", "pakka"),
            ("ज्ञान", "gyaan"),
            ("ज़िंदगी", "zindagi"),
            ("लड़का", "ladka"),
            ("ठीक", "theek"),
            ("दूध", "doodh"),
            ("कृपया", "kripya"),
            ("वापस", "wapas"),
            ("विकास", "vikas"),
        ] {
            assert_eq!(to_roman(d).to_lowercase(), r, "{d}");
        }
    }

    #[test]
    fn mixed_scripts_digits_and_punctuation() {
        assert_eq!(to_roman("आज 5 बजे call है।"), "Aaj 5 baje call hai.");
        assert_eq!(to_roman("१० बजे"), "10 baje");
        assert_eq!(to_roman("ठीक है। अब घर जा रहा हूँ।"), "Theek hai. Ab ghar ja raha hoon.");
        assert_eq!(to_roman("Plain English stays."), "Plain English stays.");
    }

    #[test]
    fn spelling_variants_fold_together() {
        for (a, b) in [("nahin", "nahi"), ("toh", "to"), ("accha", "acha"), ("theek", "thik"), ("woh", "vo"), ("hoon", "hu"), ("gayi", "gai"), ("Mein", "me"), ("phir", "fir"), ("zaroor", "jarur")] {
            assert_eq!(norm_word(a), norm_word(b), "{a} vs {b}");
        }
        assert_ne!(norm_word("main"), norm_word("mein"));
        assert_eq!(wer("Kal subah das baje meeting hai", "kal subah 10 baje meeting hai."), 0.0);
        assert!((wer("a b c d", "a x c") - 0.5).abs() < 1e-9);
        assert!(cer("bataunga", "bataoonga") < 0.01);
    }

    #[test]
    fn hinglish_markers_tell_a_transcript_from_a_translation() {
        assert!(looks_hinglish("Main kal meeting mein bataunga"));
        assert!(looks_hinglish("Mujhe Rahul ko invoice bhejna hai"));
        assert!(!looks_hinglish("I was talking to you."));
        assert!(!looks_hinglish("I have to send the invoice to Rahul."));
        assert!(!looks_hinglish("Can you send me the main deck?"));
    }
}
