%% ====================================================================
%% DUMP — LilyPond's own reading of a score, written out as JSON lines.
%%
%% Loaded before the input file (lilypond -dinclude-settings=dump.ly).
%% It changes nothing about the music. It records what LilyPond itself
%% decided while engraving, so no .ly syntax is ever re-parsed by us:
%%
%%   voice / staff  a Voice-like or Staff context came into being
%%   event          every music event, in the bottom context it was sent
%%                  to, with its exact moment and every serializable
%%                  property (the interpretation happens in TypeScript)
%%   staff-state    clef, key, ottava, as in force at each timestep
%%   step           per timestep: bar number, measure position, meter,
%%                  and the barline actually printed
%%   grob           engraving decisions that events do not carry:
%%                  printed accidentals, beams, ties, barline glyphs
%%
%% It also replaces each score's own \midi with two plain renderings of
%% exactly the music that was engraved (no \articulate, no \unfoldRepeats),
%% as witnesses for verification — see hl:midi-by-voice below.
%%
%% The dump goes to the file named by $HARMONIC_DUMP.
%% ====================================================================

#(use-modules (ice-9 format) (srfi srfi-1))

#(define hl:port (open-output-file (or (getenv "HARMONIC_DUMP") "dump.jsonl")))

%% ---- JSON writing ---------------------------------------------------

#(define (hl:json-string s)
   (string-append
    "\""
    (string-concatenate
     (map (lambda (c)
            (cond ((char=? c #\") "\\\"")
                  ((char=? c #\\) "\\\\")
                  ((char=? c #\newline) "\\n")
                  ((char=? c #\tab) "\\t")
                  ((char<? c #\space) (format #f "\\u~4,'0x" (char->integer c)))
                  (else (string c))))
          (string->list s)))
    "\""))

%% Exact rationals stay exact: "3/8", never 0.375.
#(define (hl:rational r) (hl:json-string (number->string r)))

#(define (hl:moment m)
   (format #f "{\"main\":~a,\"grace\":~a}"
           (hl:rational (ly:moment-main m))
           (hl:rational (ly:moment-grace m))))

#(define (hl:pitch p)
   (format #f "{\"octave\":~a,\"step\":~a,\"alter\":~a}"
           (ly:pitch-octave p) (ly:pitch-notename p)
           (hl:rational (ly:pitch-alteration p))))

#(define (hl:duration d)
   (format #f "{\"log\":~a,\"dots\":~a,\"factor\":~a,\"length\":~a}"
           (ly:duration-log d) (ly:duration-dot-count d)
           (hl:rational (ly:duration-scale d))
           (hl:rational (ly:duration->number d))))

%% A markup keeps both its plain text and its structure: which commands
%% wrap which text (italic, bold, dynamic, musicglyph …) is notation too.
#(define (hl:markup m)
   (format #f "{\"text\":~a,\"tree\":~a}"
           (hl:json-string (catch #t (lambda () (markup->string m)) (lambda _ "")))
           (or (hl:markup-tree m) "null")))

#(define (hl:markup-tree m)
   (cond ((string? m) (hl:json-string m))
         ((and (pair? m) (procedure? (car m)))
          (format #f "{\"cmd\":~a,\"args\":[~a]}"
                  (hl:json-string (symbol->string (or (procedure-name (car m)) 'anonymous)))
                  (string-join (filter-map (lambda (a) (if (markup? a) (hl:markup-tree a) (hl:value a)))
                                           (cdr m))
                               ",")))
         ((list? m)
          (string-append "[" (string-join (filter-map hl:markup-tree m) ",") "]"))
         (else #f)))

#(define (hl:origin loc)
   (if (ly:input-location? loc)
       (let ((flc (ly:input-file-line-char-column loc)))
         (format #f "{\"file\":~a,\"line\":~a,\"col\":~a}"
                 (hl:json-string (car flc)) (cadr flc) (cadddr flc)))
       "null"))

%% Any property value -> JSON, or #f when it has no faithful rendering
%% (procedures, grobs, contexts, and the like are skipped, not guessed).
#(define (hl:value v)
   (cond ((boolean? v) (if v "true" "false"))
         ((and (number? v) (exact? v)) (hl:rational v))
         ((and (real? v) (finite? v)) (number->string v))
         ((string? v) (hl:json-string v))
         ((symbol? v) (hl:json-string (symbol->string v)))
         ((ly:pitch? v) (hl:pitch v))
         ((ly:duration? v) (hl:duration v))
         ((ly:moment? v) (hl:moment v))
         ((markup? v) (hl:markup v))
         ((ly:music? v) (hl:music v))
         ((ly:input-location? v) (hl:origin v))
         ((null? v) "[]")
         ((and (pair? v) (list? v))
          (let ((items (filter-map hl:value v)))
            (string-append "[" (string-join items ",") "]")))
         ((pair? v)
          (let ((a (hl:value (car v))) (d (hl:value (cdr v))))
            (and a d (format #f "[~a,~a]" a d))))
         (else #f)))

%% Properties that are structure or bookkeeping, not musical content.
#(define hl:skip-props '(music-cause elements element iterator-ctor
                         elements-callback start-callback length-callback
                         to-relative-callback context tweaks))

%% \tweak settings, as [property, value] or ["Grob.property", value]: a
%% tweaked text is what prints, so it is part of the notation.
#(define (hl:tweaks tweaks)
   (string-join
    (filter-map
     (lambda (tw)
       (let* ((k (car tw))
              (name (if (pair? k)
                        (format #f "~a.~a" (car k) (cdr k))
                        (symbol->string k)))
              (v (hl:value (cdr tw))))
         (and v (format #f "[~a,~a]" (hl:json-string name) v))))
     tweaks)
    ","))

%% An object: properties, then "tweaks", as one JSON object.
#(define (hl:object props tweaks)
   (format #f "{~a}"
           (string-join (filter (lambda (x) (not (string-null? x)))
                                (list props (format #f "\"tweaks\":[~a]" (hl:tweaks tweaks))))
                        ",")))

#(define (hl:props alist)
   (string-join
    (filter-map
     (lambda (entry)
       (and (not (memq (car entry) hl:skip-props))
            (eq? entry (assq (car entry) alist))
            (let ((v (hl:value (cdr entry))))
              (and v (format #f "~a:~a" (hl:json-string (symbol->string (car entry))) v)))))
     alist)
    ","))

#(define (hl:music m)
   (hl:object (string-join (filter (lambda (x) (not (string-null? x)))
                                   (list (format #f "\"name\":~a" (hl:json-string (symbol->string (ly:music-property m 'name))))
                                         (hl:props (ly:music-mutable-properties m))))
                           ",")
              (ly:music-property m 'tweaks '())))

%% An event's properties, mutable shadowing immutable as LilyPond reads
%% them — except 'articulations, which iterators empty once they have
%% broadcast them; the originating music still holds the full list.
#(define (hl:event-props event)
   (let* ((cause (ly:event-property event 'music-cause #f))
          (articulations (if (ly:music? cause) (ly:music-property cause 'articulations) '())))
     (hl:object (hl:props (append (if (pair? articulations)
                                      (list (cons 'articulations articulations))
                                      '())
                                  (ly:prob-mutable-properties event)
                                  (ly:prob-immutable-properties event)))
                (ly:event-property event 'tweaks '()))))

%% Engraver state an event is read under but does not carry itself:
%% which way stems were forced, whether a grace is slashed, what text a
%% spanner prints, how pedals are drawn. Keyed by the event's class.
#(define (hl:grob-prop ctx grob key)
   (assoc-get key (ly:context-grob-definition ctx grob) #f))

#(define (hl:spanner-left-text ctx grob)
   (assoc-get 'text (assoc-get 'left (hl:grob-prop ctx grob 'bound-details) '()) #f))

%% The grob each event class prints as, to ask whether it is hidden.
#(define hl:event-grobs
   '((note-event . NoteHead) (rest-event . Rest) (multi-measure-rest-event . MultiMeasureRest)
     (absolute-dynamic-event . DynamicText) (crescendo-event . Hairpin) (decrescendo-event . Hairpin)
     (text-script-event . TextScript) (articulation-event . Script) (fingering-event . Fingering)
     (string-number-event . StringNumber) (slur-event . Slur) (phrasing-slur-event . PhrasingSlur)
     (sustain-event . SustainPedal) (sostenuto-event . SostenutoPedal) (una-corda-event . UnaCordaPedal)
     (tempo-change-event . MetronomeMark) (text-span-event . TextSpanner) (trill-span-event . TrillSpanner)
     (ottava-event . OttavaBracket) (arpeggio-event . Arpeggio) (rehearsal-mark-event . RehearsalMark)
     (ad-hoc-mark-event . TextMark) (tuplet-span-event . TupletNumber) (multi-measure-text-event . MultiMeasureRestText)))

%% Hidden as \hide, \omit, \hideNotes and transparent overrides make it:
%% read from the raw grob definition, so no callback is ever run early.
#(define (hl:hidden? ctx grob)
   (let ((def (ly:context-grob-definition ctx grob)))
     (or (eq? #t (assoc-get 'transparent def #f))
         (let ((st (assq 'stencil def))) (and st (not (cdr st)))))))

%% A \tweak on the event itself hides just this one.
#(define (hl:tweak-hidden? event)
   (any (lambda (tw)
          (let ((key (if (pair? (car tw)) (cdar tw) (car tw))))
            (or (and (eq? key 'transparent) (eq? (cdr tw) #t))
                (and (eq? key 'stencil) (not (cdr tw))))))
        (ly:event-property event 'tweaks '())))

#(define (hl:state ctx event)
   (define class (car (ly:event-property event 'class)))
   (define (from-props . keys) (map (lambda (k) (cons k (ly:context-property ctx k #f))) keys))
   (append
    (let ((g (assq class hl:event-grobs)))
      (if (or (hl:tweak-hidden? event) (and g (hl:hidden? ctx (cdr g))))
          (list (cons 'hidden #t))
          '()))
    (hl:class-state ctx class from-props)))

#(define (hl:class-state ctx class from-props)
   (case class
     ((note-event rest-event)
      (list (cons 'stemDirection (hl:grob-prop ctx 'Stem 'direction))
            (cons 'flagStroke (hl:grob-prop ctx 'Flag 'stroke-style))
            (cons 'noteHeadStyle (hl:grob-prop ctx 'NoteHead 'style))))
     ((crescendo-event decrescendo-event)
      (append (from-props 'crescendoSpanner 'decrescendoSpanner 'crescendoText 'decrescendoText)
              (list (cons 'defaultDirection (hl:grob-prop ctx 'DynamicLineSpanner 'direction)))))
     ((absolute-dynamic-event)
      (list (cons 'defaultDirection (hl:grob-prop ctx 'DynamicLineSpanner 'direction))))
     ((text-script-event)
      (list (cons 'defaultDirection (hl:grob-prop ctx 'TextScript 'direction))))
     ((text-span-event)
      (list (cons 'leftText (hl:spanner-left-text ctx 'TextSpanner))
            (cons 'style (hl:grob-prop ctx 'TextSpanner 'style))
            (cons 'defaultDirection (hl:grob-prop ctx 'TextSpanner 'direction))))
     ((sustain-event sostenuto-event una-corda-event)
      (from-props 'pedalSustainStyle 'pedalSostenutoStyle 'pedalUnaCordaStyle
                  'pedalSustainStrings 'pedalSostenutoStrings 'pedalUnaCordaStrings))
     ((arpeggio-event)
      (list (cons 'arpeggioDirection (hl:grob-prop ctx 'Arpeggio 'arpeggio-direction))
            (cons 'connectArpeggios (ly:context-property ctx 'connectArpeggios #f))))
     ((trill-span-event)
      (list (cons 'pitch (ly:context-property ctx 'trillPitch #f))))
     ((tempo-change-event)
      (from-props 'tempoHideNote))
     ((rehearsal-mark-event)
      (from-props 'rehearsalMark))
     (else '())))

#(define (hl:emit kind . fields)
   (display (format #f "{\"kind\":~a~a}\n"
                    (hl:json-string kind)
                    (string-concatenate
                     (map (lambda (f) (format #f ",~a:~a" (hl:json-string (car f)) (cdr f)))
                          fields)))
            hl:port))

%% ---- identities -----------------------------------------------------
%% Contexts and events are numbered on first sight; grobs refer back to
%% the events that caused them by these numbers.

#(define hl:ids (make-hash-table))
#(define hl:next-id 0)
#(define (hl:id-of obj)
   (or (hashq-ref hl:ids obj)
       (begin (set! hl:next-id (1+ hl:next-id))
              (hashq-set! hl:ids obj hl:next-id)
              hl:next-id)))
#(define (hl:known-id obj) (hashq-ref hl:ids obj))

#(define hl:score-index 0)

#(define (hl:context-fields ctx)
   (list (cons "id" (hl:id-of ctx))
         (cons "type" (hl:json-string (symbol->string (ly:context-name ctx))))
         (cons "name" (hl:json-string (ly:context-id ctx)))
         (cons "parent" (let ((p (ly:context-parent ctx))) (if p (hl:id-of p) "null")))))

#(define (hl:now ctx) (hl:moment (ly:context-current-moment ctx)))

#(define (hl:staff-of ctx)
   (let ((s (ly:context-find ctx 'Staff)))
     (if s (hl:id-of s) "null")))

%% ---- bottom contexts: every event, attributed to its voice ----------

#(define hl:attributed (make-hash-table))

#(define (hl:event-engraver ctx)
   (make-engraver
    ((initialize engraver)
     (apply hl:emit "voice"
            (append (hl:context-fields ctx)
                    (list (cons "at" (hl:now ctx))
                          (cons "staff" (hl:staff-of ctx))))))
    (listeners
     ((music-event engraver event)
      (hashq-set! hl:attributed event #t)
      (hl:emit "event"
               (cons "id" (hl:id-of event))
               (cons "voice" (hl:id-of ctx))
               (cons "staff" (hl:staff-of ctx))
               (cons "at" (hl:now ctx))
               (cons "class" (hl:json-string (symbol->string (car (ly:event-property event 'class)))))
               (cons "props" (hl:event-props event))
               (cons "state" (format #f "{~a}" (hl:props (hl:state ctx event))))
               (cons "origin" (hl:origin (ly:event-property event 'origin))))))))

%% ---- staves: clef, key, ottava as in force -------------------------

#(define hl:staff-props '(clefGlyph clefPosition clefTransposition keyAlterations tonic
                          ottavation middleCOffset instrumentName shortInstrumentName))

#(define (hl:staff-grob-state ctx)
   (list (cons 'timeSignatureStyle (hl:grob-prop ctx 'TimeSignature 'style))
         (cons 'timeSignatureHidden (hl:hidden? ctx 'TimeSignature))))

#(define (hl:staff-engraver ctx)
   (let ((last #f))
     (make-engraver
      ((initialize engraver)
       (apply hl:emit "staff" (hl:context-fields ctx)))
      ((process-music engraver)
       (let ((now (hl:props (append (map (lambda (p) (cons p (ly:context-property ctx p #f)))
                                         hl:staff-props)
                                    (hl:staff-grob-state ctx)))))
         (if (not (equal? now last))
             (begin
               (set! last now)
               (hl:emit "staff-state"
                        (cons "staff" (hl:id-of ctx))
                        (cons "at" (hl:now ctx))
                        (cons "props" (format #f "{~a}" now))))))))))

%% ---- score: timing, barlines, and the grob-level decisions ----------

#(define hl:score-props '(currentBarNumber measurePosition measureLength tempoWholesPerMinute
                          timeSignature timing whichBar))

#(define (hl:cause-id grob)
   (let ((c (and (ly:grob? grob) (ly:grob-property grob 'cause #f))))
     (if (ly:stream-event? c) (or (hl:known-id c) "null") "null")))

#(define (hl:grob-list grob key)
   (let ((a (ly:grob-object grob key #f)))
     (if (ly:grob-array? a) (ly:grob-array->list a) '())))

#(define (hl:score-engraver ctx)
   (let ((ties '()) (unattributed '()))
     (make-engraver
      ((initialize engraver)
       (set! hl:score-index (1+ hl:score-index))
       (hl:emit "score" (cons "index" hl:score-index)))
      (listeners
       ;; Events sent straight to Staff or Score level are heard only here.
       ((music-event engraver event)
        (set! unattributed (cons event unattributed))))
      ((stop-translation-timestep engraver)
       (for-each
        (lambda (event)
          (if (not (hashq-ref hl:attributed event))
              (hl:emit "event"
                       (cons "id" (hl:id-of event))
                       (cons "voice" "null")
                       (cons "staff" "null")
                       (cons "at" (hl:now ctx))
                       (cons "class" (hl:json-string (symbol->string (car (ly:event-property event 'class)))))
                       (cons "props" (hl:event-props event))
                       (cons "origin" (hl:origin (ly:event-property event 'origin))))))
        (reverse unattributed))
       (set! unattributed '())
       (hl:emit "step"
                (cons "at" (hl:now ctx))
                (cons "props" (format #f "{~a}"
                                      (hl:props (map (lambda (p) (cons p (ly:context-property ctx p #f)))
                                                     hl:score-props))))))
      (acknowledgers
       ((accidental-interface engraver grob source)
        (hl:emit "grob"
                 (cons "grob" (hl:json-string (symbol->string (grob::name grob))))
                 (cons "event" (hl:cause-id grob))
                 (cons "alteration" (hl:value (ly:grob-property grob 'alteration)))
                 (cons "parenthesized" (hl:value (ly:grob-property grob 'parenthesized #f)))))
       ((tie-interface engraver grob source)
        (set! ties (cons grob ties)))
       ;; The barline as printed, per staff: repeat signs included, which
       ;; the whichBar property alone no longer reports.
       ((bar-line-interface engraver grob source)
        (let ((staff (ly:context-find (ly:translator-context source) 'Staff)))
          (if (eq? (grob::name grob) 'BarLine)
           (hl:emit "grob"
                   (cons "grob" (hl:json-string (symbol->string (grob::name grob))))
                   (cons "at" (hl:now ctx))
                   (cons "staff" (if staff (hl:id-of staff) "null"))
                   (cons "glyph" (or (hl:value (ly:grob-property grob 'glyph #f)) "null"))
                   (cons "hidden" (if (or (eq? #t (ly:grob-property-data grob 'transparent))
                                          (not (ly:grob-property-data grob 'stencil)))
                                      "true" "false")))))))
      (end-acknowledgers
       ((beam-interface engraver grob source)
        (hl:emit "grob"
                 (cons "grob" (hl:json-string (symbol->string (grob::name grob))))
                 (cons "stems"
                       (hl:value
                        (map (lambda (stem)
                               (map hl:cause-id (hl:grob-list stem 'note-heads)))
                             (hl:grob-list grob 'stems)))))))
      ((finalize engraver)
       (for-each
        (lambda (tie)
          (hl:emit "grob"
                   (cons "grob" (hl:json-string "Tie"))
                   (cons "from" (hl:cause-id (ly:spanner-bound tie LEFT)))
                   (cons "to" (hl:cause-id (ly:spanner-bound tie RIGHT)))))
        (reverse ties))
       (force-output hl:port)))))

\layout {
  \context { \Score \consists #hl:score-engraver }
  \context { \Staff \consists #hl:staff-engraver }
  \context { \Voice \consists #hl:event-engraver }
  \context { \Dynamics \consists #hl:event-engraver }
}

%% ---- outputs: layout as written, plus a plain MIDI of the same music ----

%% Two plain MIDI renderings are made of each engraved score, both with no
%% Tempo_performer — no tempo, so they play at the SMF default of 120 bpm
%% and their seconds are plain musical time:
%%
%%   by voice   one track per Voice, grace notes removed: every other note
%%              exactly as written, unisons between voices kept apart, and
%%              nothing shortened to make room for a grace
%%   by staff   one track per Staff, as LilyPond performs by default: which
%%              hand each note is in, and the grace notes themselves
#(define hl:midi-by-voice
   #{ \midi {
        \context { \Score \remove "Tempo_performer" }
        \context { \Staff \remove "Staff_performer" }
        \context { \Voice \consists "Staff_performer" }
      } #})
#(define hl:midi-by-staff #{ \midi { \context { \Score \remove "Tempo_performer" } } #})

%% Grace music takes no time, so an empty sequence stands in for it.
#(define (hl:without-graces music)
   (music-map (lambda (m)
                (if (eq? 'GraceMusic (ly:music-property m 'name))
                    (make-music 'SequentialMusic 'elements '())
                    m))
              music))

%% Articulations carry their own MIDI lengths (staccato plays half, for
%% instance): performance choices, not notation. They are cleared, in a
%% copy used only for MIDI, so the MIDI states written durations.
#(define (hl:clear-midi-lengths! m)
   (if (ly:music? m)
       (begin
         (if (procedure? (ly:music-property m 'midi-length #f))
             (ly:music-set-property! m 'midi-length '()))
         (for-each hl:clear-midi-lengths!
                   (append (ly:music-property m 'elements '())
                           (ly:music-property m 'articulations '())
                           (let ((e (ly:music-property m 'element #f))) (if e (list e) '()))))))
   m)

#(define (hl:layout-def? def) (eq? 'layout (ly:output-def-lookup def 'output-def-kind #f)))

#(define toplevel-score-handler
   (lambda (score)
     (let* ((defs (ly:score-output-defs score))
            (layouts (filter hl:layout-def? defs)))
       ;; A score with only \midi was the source's own performance
       ;; rendering; it is dropped in favour of ours.
       (if (or (null? defs) (pair? layouts))
           (let* ((music (ly:score-music score))
                  (plain (hl:clear-midi-lengths! (ly:music-deep-copy music)))
                  (engraved (ly:make-score music))
                  (by-voice (ly:make-score (hl:without-graces (ly:music-deep-copy plain))))
                  (by-staff (ly:make-score plain)))
             (if (module? (ly:score-header score))
                 (ly:score-set-header! engraved (ly:score-header score)))
             (for-each (lambda (d) (ly:score-add-output-def! engraved d)) layouts)
             (if (null? layouts)
                 (ly:score-add-output-def! engraved $defaultlayout))
             (ly:score-add-output-def! by-voice hl:midi-by-voice)
             (ly:score-add-output-def! by-staff hl:midi-by-staff)
             (hl:emit "header"
                      (cons "book" (hl:header $defaultheader))
                      (cons "score" (hl:header (ly:score-header score))))
             ;; MIDI files are numbered in this order: by voice, then by staff.
             (collect-scores-for-book engraved)
             (collect-scores-for-book by-voice)
             (collect-scores-for-book by-staff))))))

#(define (hl:header mod)
   (if (module? mod)
       (format #f "{~a}" (hl:props (ly:module->alist mod)))
       "{}"))
