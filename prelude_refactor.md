Let's rebuild the structure of the app around learning this include Chopin prelude, specifically.

We want to be able to view actual sheet music (as it would appear in a PDF, but in whatever data format suitable to this repo) alongside (above) the piano roll practice view.

We want to be able to isolate both sheet music and the run of practice to individual bars, in order to isolate and practice particular, difficult runs. 

We want to be able to ALSO play an audio track—a real recording—or, at least, somehow map the timestamps to listen to the audio repeatedly, to get the musicality down. It might be enough to have a youtube player up in another window and scrub back and forth on the timestamps—but we need to be able to link bars of a score to timestamps on a recording, even if I have to do this manually. Let's forgo implementing a new technical solution for this so far, and keep it as a possible future note.

So:

I want to be able to view sheet music—which reads as sheet music, not the HTML UI we currently have—and display it 