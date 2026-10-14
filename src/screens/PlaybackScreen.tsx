import { localizedError, displayRecordingTitle, formatDate, formatDuration, t, useLocalizedStyles } from '../i18n';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useRecording } from '../context/RecordingContext';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { colors, ui } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const messageOf = (error: unknown) => localizedError(error, 'copy259');
const time = formatDuration;

export default function PlaybackScreen() {
  const styles = useLocalizedStyles(baseStyles);
  const insets = useSafeAreaInsets();
  const { params: { recordingId } } = useRoute<RouteProp<RootStackParamList, 'Playback'>>();
  const { recordings, shareRecording, isRecording, isBusy } = useRecording();
  const recording = recordings.find(item => item.id === recordingId);
  const audioPlayer = useMemo(() => new AudioRecorderPlayer(), []);
  const active = useRef(false);
  const operation = useRef(false);
  const [playerState, setPlayerState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const stop = useCallback(async () => {
    audioPlayer.removePlayBackListener();
    try { await audioPlayer.stopPlayer(); }
    finally {
      if (active.current) {
        setPlayerState('stopped');
        setPosition(0);
      }
    }
  }, [audioPlayer]);

  useFocusEffect(useCallback(() => {
    active.current = true;
    setPlayerState('stopped');
    setPosition(0);
    setDuration(0);
    setPlayerBusy(operation.current);
    return () => {
      active.current = false;
      audioPlayer.removePlayBackListener();
      void audioPlayer.stopPlayer().catch(() => undefined);
    };
  }, [audioPlayer]));

  const toggle = async () => {
    if (!recording || isRecording || operation.current) return;
    operation.current = true;
    setPlayerBusy(true);
    setPlayerError(null);
    try {
      if (playerState === 'playing') {
        await audioPlayer.pausePlayer();
        if (active.current) setPlayerState('paused');
      } else if (playerState === 'paused') {
        await audioPlayer.resumePlayer();
        if (active.current) setPlayerState('playing');
      } else {
        audioPlayer.addPlayBackListener(event => {
          if (!active.current) return;
          setPosition(Math.max(0, event.currentPosition));
          if (Number.isFinite(event.duration) && event.duration > 0) setDuration(event.duration);
          if (event.isFinished || (event.duration > 0 && event.currentPosition >= event.duration)) {
            void stop().catch(failure => { if (active.current) setPlayerError(messageOf(failure)); });
          }
        });
        // startPlayer resolves a URI string; duration comes from playback events.
        await audioPlayer.startPlayer(recording.filePath);
        if (!active.current) {
          await audioPlayer.stopPlayer();
          return;
        }
        await audioPlayer.setVolume(1);
        setPlayerState('playing');
      }
    } catch (failure) {
      audioPlayer.removePlayBackListener();
      await audioPlayer.stopPlayer().catch(() => undefined);
      if (active.current) {
        setPlayerState('stopped');
        setPlayerError(messageOf(failure));
      }
    } finally {
      operation.current = false;
      if (active.current) setPlayerBusy(false);
    }
  };

  const handleStop = async () => {
    if (operation.current) return;
    operation.current = true;
    setPlayerBusy(true);
    try { await stop(); }
    catch (failure) { if (active.current) setPlayerError(messageOf(failure)); }
    finally {
      operation.current = false;
      if (active.current) setPlayerBusy(false);
    }
  };

  const handleShare = async () => {
    if (!recording || isBusy || recording.source === 'legacy') return;
    try { await shareRecording(recording.id); }
    catch (failure) { Alert.alert(t('copy260'), messageOf(failure)); }
  };

  if (!recording) {
    return <View style={styles.container}><Text style={styles.missing}>{t('copy261')}</Text></View>;
  }

  const totalDuration = duration || recording.durationMs || 0;
  const progress = totalDuration > 0 ? Math.min(1, position / totalDuration) : 0;
  const outputMissing = recording.captureSource === 'usb' && (recording.outputSoundMs ?? 0) < 200;
  const microphoneMissing = recording.captureSource === 'usb' && (recording.microphoneSoundMs ?? 0) < 200;
  const channelWarning = outputMissing || microphoneMissing
    ? t('copy262', { p0: outputMissing ? t('copy228') : '', p1: microphoneMissing ? t('copy229') : '' }) : null;
  const warning = recording.status === 'silent' ? t('copy263')
    : recording.status === 'interrupted' ? t('copy264')
      : recording.status === 'recovered' ? t('copy265')
        : recording.wasSilenced ? t('copy266') : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: Math.max(32, insets.bottom + 20) }]}>
      <Text style={styles.title}>{displayRecordingTitle(recording.title, recording.callDisplayName)}</Text>
      <Text style={styles.date}>{formatDate(recording.date)}</Text>
      <View style={styles.card}>
        <Text style={styles.source}>{recording.source === 'legacy' ? t('copy267') : recording.captureSource === 'accessibilityMic' ? t('accessibilityMicLabel') : recording.captureSource === 'usb' ? t('copy246') : t('copy245')}</Text>
        {recording.captureSource === 'accessibilityMic' && <Text style={styles.warning}>{t('accessibilityMicRecordingNote')}</Text>}
        {warning && <Text style={styles.warning}>{warning}</Text>}
        {channelWarning && <Text style={styles.warning}>{channelWarning}</Text>}
        {isRecording && <Text style={styles.warning}>{t('copy268')}</Text>}
        {playerError && <Text style={styles.warning}>{t('copy269')}{' '}{localizedError(playerError)}</Text>}
        <View style={styles.timeRow}><Text style={styles.time}>{time(position)}</Text><Text style={styles.time}>{totalDuration > 0 ? time(totalDuration) : recording.duration}</Text></View>
        <View style={styles.progressTrack} accessibilityRole="progressbar" accessibilityLabel={t('copy270')} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}><View style={[styles.progressFill, { width: `${progress * 100}%` }]} /></View>
        <View style={styles.controls}>
          <TouchableOpacity style={[styles.playButton, (isRecording || playerBusy) && ui.disabled]} onPress={() => { void toggle(); }} disabled={isRecording || playerBusy} accessibilityRole="button" accessibilityState={{ disabled: isRecording || playerBusy }}><Text style={styles.playText}>{playerBusy ? t('copy271') : playerState === 'playing' ? t('copy272') : playerState === 'paused' ? t('copy273') : t('copy274')}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.stopButton, (playerState === 'stopped' || playerBusy) && ui.disabled]} onPress={() => { void handleStop(); }} disabled={playerState === 'stopped' || playerBusy} accessibilityRole="button" accessibilityState={{ disabled: playerState === 'stopped' || playerBusy }}><Text style={styles.stopText}>{t('copy275')}</Text></TouchableOpacity>
        </View>
        {recording.source === 'native' && <TouchableOpacity style={[styles.shareButton, isBusy && ui.disabled]} onPress={() => { void handleShare(); }} disabled={isBusy} accessibilityRole="button" accessibilityState={{ disabled: isBusy }}><Text style={styles.shareText}>{t('copy276')}</Text></TouchableOpacity>}
      </View>
      <Text style={styles.caption}>{t('copy277')}</Text>
    </ScrollView>
  );
}

const baseStyles = StyleSheet.create({
  container: ui.screen,
  content: { ...ui.content, paddingTop: 20 },
  title: { ...ui.title, fontSize: 24, lineHeight: 34 },
  date: { ...ui.subtitle, marginTop: 8, marginBottom: 24 },
  card: ui.card,
  source: { ...ui.subtitle, color: colors.green, fontWeight: '600', marginBottom: 18 },
  warning: { ...ui.warning, marginBottom: 12 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  time: { color: colors.ink, fontSize: 16, fontVariant: ['tabular-nums'], writingDirection: 'ltr', flexShrink: 1 },
  progressTrack: { height: 5, backgroundColor: colors.border, borderRadius: 4, marginTop: 12, overflow: 'hidden' },
  progressFill: { height: 5, backgroundColor: colors.green, borderRadius: 4 },
  controls: { flexDirection: 'row-reverse', justifyContent: 'center', gap: 14, marginVertical: 24 },
  playButton: { ...ui.primaryButton, flex: 1 },
  playText: ui.primaryText,
  stopButton: { ...ui.secondaryButton, flex: 1 },
  stopText: ui.secondaryText,
  shareButton: { minHeight: 52, padding: 14, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  shareText: { color: colors.green, fontSize: 15, fontWeight: '600', writingDirection: 'rtl' },
  caption: { ...ui.subtitle, textAlign: 'center', marginTop: 18 },
  missing: { ...ui.body, textAlign: 'center', margin: 30 },
});
