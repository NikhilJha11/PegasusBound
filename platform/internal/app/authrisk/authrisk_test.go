package authrisk

import (
	"testing"
	"time"
)

var (
	london    = Place{CountryCode: "GB", Latitude: 51.5074, Longitude: -0.1278}
	sydney    = Place{CountryCode: "AU", Latitude: -33.8688, Longitude: 151.2093}
	newYork   = Place{CountryCode: "US", Latitude: 40.7128, Longitude: -74.0060}
	reading   = Place{CountryCode: "GB", Latitude: 51.4543, Longitude: -0.9781}
	baseClock = time.Date(2026, 3, 10, 12, 0, 0, 0, time.UTC)
)

func at(p Place, t time.Time) Place { p.At = t; return p }

func TestAssessFlagsImpossibleTravel(t *testing.T) {
	// London to Sydney in ten minutes.
	v := Assess(ptr(at(london, baseClock)), at(sydney, baseClock.Add(10*time.Minute)))
	if !v.Flagged {
		t.Fatalf("London to Sydney in 10 minutes was not flagged: %+v", v)
	}
	if v.ImpliedKmh <= MaxPlausibleKmh {
		t.Errorf("implied speed = %.0f km/h, want it above the plausible ceiling", v.ImpliedKmh)
	}
	if v.Reason == "" {
		t.Error("a flagged sign-in must say why")
	}
}

// The failure that would hurt most: locking a real person out of their own
// account. A long flight is exactly what a travelling customer does.
func TestAssessAllowsARealJourney(t *testing.T) {
	// London to New York in nine hours is an ordinary flight.
	if v := Assess(ptr(at(london, baseClock)), at(newYork, baseClock.Add(9*time.Hour))); v.Flagged {
		t.Errorf("a nine-hour transatlantic flight was flagged: %+v", v)
	}
	// A day later, anywhere is reachable.
	if v := Assess(ptr(at(london, baseClock)), at(sydney, baseClock.Add(24*time.Hour))); v.Flagged {
		t.Errorf("Sydney a day after London was flagged: %+v", v)
	}
}

// City centroids are coarse. Two sign-ins from one metro area must not imply a
// journey just because the points differ.
func TestAssessIgnoresShortDistances(t *testing.T) {
	if v := Assess(ptr(at(london, baseClock)), at(reading, baseClock.Add(3*time.Minute))); v.Flagged {
		t.Errorf("a 60 km hop was flagged: %+v", v)
	}
}

// Two sign-ins seconds apart are far more likely a proxy or a redirect than a
// journey, and dividing by that interval makes any distance look impossible.
func TestAssessIgnoresTooShortAnInterval(t *testing.T) {
	if v := Assess(ptr(at(london, baseClock)), at(sydney, baseClock.Add(5*time.Second))); v.Flagged {
		t.Errorf("a 5-second interval was judged: %+v", v)
	}
}

func TestAssessWithNoHistoryOrNoPosition(t *testing.T) {
	// A first sign-in has nothing to compare against; challenging it would
	// challenge every new user.
	if v := Assess(nil, at(sydney, baseClock)); v.Flagged {
		t.Errorf("a first sign-in was flagged: %+v", v)
	}
	// No coordinates and the same country: nothing to say.
	noPos := Place{CountryCode: "GB", At: baseClock}
	if v := Assess(&noPos, Place{CountryCode: "GB", At: baseClock.Add(time.Minute)}); v.Flagged {
		t.Errorf("same country without coordinates was flagged: %+v", v)
	}
	// No coordinates but a country change within the hour is the fallback.
	if v := Assess(&noPos, Place{CountryCode: "AU", At: baseClock.Add(10 * time.Minute)}); !v.Flagged {
		t.Errorf("a country change within 10 minutes was not flagged: %+v", v)
	}
	// The same change a day later is just travel.
	if v := Assess(&noPos, Place{CountryCode: "AU", At: baseClock.Add(25 * time.Hour)}); v.Flagged {
		t.Errorf("a country change a day later was flagged: %+v", v)
	}
}

// Backdated rows and clock skew between instances must not read as a signal.
func TestAssessIgnoresNegativeElapsed(t *testing.T) {
	if v := Assess(ptr(at(sydney, baseClock)), at(london, baseClock.Add(-time.Hour))); v.Flagged {
		t.Errorf("a backwards interval was judged: %+v", v)
	}
}

// A zero coordinate pair is a real point at sea as well as "unknown", so it
// must not be treated as a location.
func TestAssessTreatsZeroCoordinatesAsUnknown(t *testing.T) {
	zero := Place{CountryCode: "GB", At: baseClock}
	if zero.HasPosition() {
		t.Error("0,0 should not count as a known position")
	}
	if v := Assess(&zero, at(sydney, baseClock.Add(time.Minute))); v.ImpliedKmh != 0 {
		t.Errorf("a distance was computed from an unknown origin: %+v", v)
	}
}

func ptr(p Place) *Place { return &p }
