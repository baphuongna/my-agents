export function areExperimentalFeaturesEnabled() {
    return process.env.PI_EXPERIMENTAL === "1";
}
