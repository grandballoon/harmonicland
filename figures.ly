\version "2.24.0"

% figures.ly — a fixture for the SPOKEN SCORE panel, not for the eye.
% The bundled scores have no repeated gesture (see spoken-score.md, Task 6),
% so nothing in the repo makes the panel's `figure` summary line appear.
% This does, in both of its forms:
%
%   bars 1-4   the same four-chord figure, three times  -> "played three times"
%   bars 6-9   the same two-chord figure, walking up in minor thirds
%              -> "then again up a minor third, then again up a tritone"
%
% Two rules of the model to respect when editing this file, both of which
% cost me a first draft:
%   - A figure played N times is N times its TRANSITIONS, so each block must
%     restate its first chord at the end to close the loop.
%   - Two identical sonorities in a row are ONE state with repeat 2, and the
%     repeat count is part of a gesture's identity. Hence bar 5: without a
%     separating chord, block 1's last chord and block 2's first would merge
%     and the third statement would stop matching.

\score {
  \new Staff \relative c' {
    \clef treble
    % --- a literal repeat, three statements ---------------------------
    <c e g>2 <d f a> <b d g> <c f a>   |
    <c e g>2 <d f a> <b d g> <c f a>   |
    <c e g>2 <d f a> <b d g> <c f a>   |
    <c e g>1                           |
    % --- a separator, so the two blocks stay two states ---------------
    <g' b d>1                          |
    % --- the same two-chord figure, up a minor third each time --------
    <c, e g>2 <d f a>                  |
    <ees g bes>2 <f aes c>             |
    <fis ais cis>2 <gis b dis>         |
    <a cis e>1                         |
  }
}
