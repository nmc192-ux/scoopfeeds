"""Unit tests for render60's logo rule: python -m unittest sixty/render/test_logo_layout.py (render venv)."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render60 as R60


class FakeClip:
    """The bits of engine.Clip that crop_windows reads."""
    def __init__(self, cams, t0=0.0, T=10.0, ymax=1.0):
        self.cams, self.t0, self.T, self.ymax = cams, t0, T, ymax
    def cam(self, ta):                      # same interpolation shape as E.Clip.cam, linear is enough for the test
        cs = self.cams
        if ta <= cs[0][0]: return cs[0][1:]
        for a, b in zip(cs, cs[1:]):
            if ta <= b[0]:
                p = (ta - a[0]) / max(b[0] - a[0], 1e-3); return tuple(x + (y - x) * p for x, y in zip(a[1:], b[1:]))
        return cs[-1][1:]

SW, SH = 1920, 1080
DVIDS_LOGO = (0.86, 0.86, 0.95, 0.96)       # the Pentagon bug on the 2 Oct DVIDS footage


class LogoLayout(unittest.TestCase):
    def test_the_dvids_case_centre_crop_cuts_the_bug(self):
        c = FakeClip([(0, 0.5, 0.5, 1.0), (10, 0.5, 0.5, 1.0)])
        self.assertFalse(R60.crop_keeps_logo(c, DVIDS_LOGO, SW, SH))

    def test_a_crop_that_contains_the_logo_stays_a_crop(self):
        c = FakeClip([(0, 0.5, 0.5, 1.0), (10, 0.5, 0.5, 1.0)])
        self.assertTrue(R60.crop_keeps_logo(c, (0.45, 0.4, 0.55, 0.6), SW, SH))

    def test_a_pan_must_keep_the_logo_at_every_moment(self):
        # starts centred (logo cut), ends at the far right (logo inside): not good enough
        c = FakeClip([(0, 0.5, 0.5, 1.0), (10, 1.0, 0.5, 1.0)])
        self.assertFalse(R60.crop_keeps_logo(c, DVIDS_LOGO, SW, SH))
        c2 = FakeClip([(0, 1.0, 0.5, 1.0), (10, 1.0, 0.5, 1.0)])      # parked at the right edge the whole time
        self.assertTrue(R60.crop_keeps_logo(c2, DVIDS_LOGO, SW, SH))

    def test_zooming_in_can_cut_a_logo_the_wide_crop_kept(self):
        wide = FakeClip([(0, 0.5, 0.5, 1.0), (10, 0.5, 0.5, 1.0)])
        tight = FakeClip([(0, 0.5, 0.5, 1.0), (10, 0.5, 0.5, 2.5)])
        box = (0.46, 0.30, 0.54, 0.40)
        self.assertTrue(R60.crop_keeps_logo(wide, box, SW, SH))
        self.assertFalse(R60.crop_keeps_logo(tight, (0.50, 0.05, 0.54, 0.12), SW, SH))

    def test_ymax_banner_crop_counts(self):
        c = FakeClip([(0, 0.5, 0.5, 1.0), (10, 0.5, 0.5, 1.0)], ymax=0.85)
        self.assertFalse(R60.crop_keeps_logo(c, (0.45, 0.9, 0.55, 0.98), SW, SH))   # the bottom 15% is cropped away

    def test_logo_box_parsing(self):
        self.assertIsNone(R60.logo_box('none')); self.assertIsNone(R60.logo_box(None))
        self.assertEqual(R60.logo_box('BR'), R60.LOGO_CORNERS['br'])
        self.assertEqual(R60.logo_box([0.1, 0.1, 0.2, 0.2]), (0.1, 0.1, 0.2, 0.2))
        for bad in ('middle', [1, 2, 3], [0.5, 0.5, 0.4, 0.9], [0, 0, 1.5, 1], 7):
            with self.assertRaises(SystemExit): R60.logo_box(bad)

    def test_a_corner_code_in_the_bottom_right_also_triggers_the_band_on_a_centre_crop(self):
        c = FakeClip([(0, 0.5, 0.5, 1.0), (10, 0.5, 0.5, 1.0)])
        self.assertFalse(R60.crop_keeps_logo(c, R60.logo_box('br'), SW, SH))

    def test_band_geometry_clears_the_pin_and_the_captions(self):
        bh = round(SH * R60.W / SW)                          # 16:9 at full width
        self.assertEqual(bh, 608)
        self.assertGreater(R60.BAND_Y0 - R60.BAND_RULE, R60.PIN_Y + 80)          # pin card ends before the top rule
        self.assertLess(R60.BAND_Y0 + bh + R60.BAND_RULE, 1190)                  # captions start at y 1190
        self.assertLess(R60.BAND_LABEL_Y, 1190)                                   # name bar fits between band and captions


if __name__ == '__main__':
    unittest.main()
