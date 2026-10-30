package com.liquidglass.photos;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.MediaController;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

/**
 * Full-screen native video player.
 *
 * WebView's media player does not fetch <video> sources through
 * shouldInterceptRequest, so videos are played here with the platform
 * decoder instead of inside the WebView.
 */
public class PlayerActivity extends Activity {

    private VideoView vv;
    private Uri uri;
    private boolean triedExternal = false;

    private int dp(float v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v,
                getResources().getDisplayMetrics());
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setBackgroundDrawableResource(android.R.color.black);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION);

        uri = getIntent().getData();

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        vv = new VideoView(this);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        lp.gravity = Gravity.CENTER;
        root.addView(vv, lp);

        MediaController mc = new MediaController(this);
        mc.setAnchorView(vv);
        vv.setMediaController(mc);

        TextView close = new TextView(this);
        close.setText("\u00d7");
        close.setTextColor(Color.WHITE);
        close.setTextSize(26);
        close.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0x66000000);
        bg.setStroke(dp(1), 0x66FFFFFF);
        close.setBackground(bg);
        FrameLayout.LayoutParams clp = new FrameLayout.LayoutParams(dp(44), dp(44));
        clp.gravity = Gravity.TOP | Gravity.END;
        clp.topMargin = dp(28);
        clp.rightMargin = dp(16);
        close.setLayoutParams(clp);
        close.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                finish();
            }
        });
        root.addView(close);

        vv.setOnPreparedListener(new MediaPlayer.OnPreparedListener() {
            public void onPrepared(MediaPlayer mp) {
                mp.setLooping(false);
                vv.start();
            }
        });

        vv.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
            public void onCompletion(MediaPlayer mp) {
                // stay on the last frame; the controller lets the user replay
            }
        });

        vv.setOnErrorListener(new MediaPlayer.OnErrorListener() {
            public boolean onError(MediaPlayer mp, int what, int extra) {
                if (!triedExternal) {
                    triedExternal = true;
                    openInSystemPlayer();
                }
                return true;
            }
        });

        if (uri == null) {
            Toast.makeText(this, "Cannot open this video", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        vv.setVideoURI(uri);
        vv.requestFocus();
    }

    /** If the platform decoder refuses the file, hand it to whatever player the phone has. */
    private void openInSystemPlayer() {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "video/*");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "This video cannot be played on this device",
                    Toast.LENGTH_LONG).show();
        }
        finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (vv != null && vv.isPlaying()) vv.pause();
    }

    @Override
    protected void onDestroy() {
        if (vv != null) {
            try {
                vv.stopPlayback();
            } catch (Exception ignored) {
            }
        }
        super.onDestroy();
    }
}
