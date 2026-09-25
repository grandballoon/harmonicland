% One small piano score touching every kind of thing to-score.ts converts.
% features.dump.jsonl is LilyPond's reading of it, and features.by-voice.midi
% and features.by-staff.midi its two witness performances. Regenerate all
% three with:  node tools/library/lilypond/fixtures/make.ts
\version "2.26.0"

fingerChange = -\tweak text #(markup #:tied-lyric "2~3") -0

upper = \relative c'' {
  \key g \major
  \time 3/4
  \tempo "Andante" 4 = 72
  \partial 4 d4\p |
  \repeat volta 2 {
    <b-1 d-3 g-5>4-. \acciaccatura a8 g4( fis8) r |
    \tuplet 3/2 { e8 fis g } a2~\< |
    a4\! b2^\markup \italic "dolce" |
  }
  \alternative {
    { c2. | }
    { \ottava #1 c'2 \ottava #0 b,4 | }
  }
  << { d2. } \\ { s4 s4^\fingerChange s4 } >> |
  \once \hide Hairpin
  g,2\< a4\! \bar "|."
}

lower = \relative c {
  \key g \major
  \time 3/4
  \clef bass
  \partial 4 r4 |
  \repeat volta 2 {
    g4\sustainOn d'\sustainOff\sustainOn g\sustainOff |
    c,2. |
    d2 \clef treble d''4 |
  }
  \alternative {
    { \clef bass e,,2. | }
    { a2. | }
  }
  b4 d \change Staff = "upper" g' \change Staff = "lower" |
  <g,, d'>2. | \bar "|."
}

\score {
  \new PianoStaff <<
    \new Staff = "upper" \upper
    \new Staff = "lower" \lower
  >>
  \layout { }
}
