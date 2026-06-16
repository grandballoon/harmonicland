\version "2.24.0"

% sample-lily.ly — a small two-hand piece for Notation Animator.
% Exercises the LilyIn subset: \relative octaves, flat spellings (es),
% a chord < >, a tie ~, \tempo, and two braced voices on a grand staff.
% Load with "Load file", then switch to "Grand staff".

\header { title = "Lily Sample" composer = "test fixture" }

\score {
  <<
    % right hand — a descending line in flats
    \new Staff \relative c'' {
      \tempo 4 = 72
      \clef treble
      \key ees \major
      bes4 aes g f          |
      ees2 f4. ees8~        |
      ees2 <ees g bes>2     |
    }
    % left hand — slow chords down in the bass clef
    \new Staff \relative c {
      \clef bass
      <ees g>2 <aes, c>      |
      <bes des>2 <ees g>     |
      <aes, ees' aes>1       |
    }
  >>
}
