import { t, useLocalization, useLocalizedStyles } from '../i18n';
import React, { useCallback, useRef, useState } from 'react';
import { createNavigationContainerRef, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import RecordingsScreen from '../screens/RecordingsScreen';
import PlaybackScreen from '../screens/PlaybackScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { colors } from '../theme';
import SetupScreen from '../screens/SetupScreen';
import { useSetup } from '../setup/SetupContext';
import { setupInitialRoute } from '../setup/connectionFlow';
import { useRestartResume } from '../hooks/useRestartResume';

export type RootStackParamList = {
  Home: undefined;
  Recordings: undefined;
  Playback: { recordingId: string };
  Settings: undefined;
  Setup: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const styles = useLocalizedStyles(baseStyles);
  const { isRTL } = useLocalization();
  const { loading, completed, readiness } = useSetup();
  const navigation = useRef(createNavigationContainerRef<RootStackParamList>());
  const [navigationReady, setNavigationReady] = useState(false);
  const openRestartSetup = useCallback(() => {
    if (navigation.current.isReady()) navigation.current.navigate('Setup');
  }, []);
  useRestartResume(!loading && navigationReady, openRestartSetup);
  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.green} /><Text style={styles.loadingText}>{t('copy215')}</Text></View>;
  return (
    <NavigationContainer ref={navigation.current} onReady={() => setNavigationReady(true)} direction={isRTL ? 'rtl' : 'ltr'} theme={{ ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: colors.green, background: colors.background, card: colors.background, text: colors.ink, border: colors.border, notification: colors.danger } }}>
      <Stack.Navigator
        initialRouteName={setupInitialRoute(completed, readiness.mode)}
        screenOptions={{
          headerStyle: { backgroundColor: colors.background, elevation: 0, shadowOpacity: 0, borderBottomWidth: 0 },
          headerTintColor: colors.ink,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerTitleAlign: 'center',
          headerBackTitle: t('copy216'),
        }}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: t('copy217'), headerShown: false }} />
        <Stack.Screen name="Recordings" component={RecordingsScreen} options={{ title: t('copy194'), headerShown: false }} />
        <Stack.Screen name="Playback" component={PlaybackScreen} options={{ title: t('copy218') }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('copy195'), headerShown: false }} />
        <Stack.Screen name="Setup" component={SetupScreen} options={{ title: t('copy219'), headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const baseStyles = StyleSheet.create({
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, gap: 16 },
  loadingText: { color: colors.muted, fontSize: 14, writingDirection: 'rtl', textAlign: 'center' },
});
