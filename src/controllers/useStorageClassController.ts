import { useEffect, type ActionDispatch } from "react";
import { patchResource, type Action, type AppState } from "../store/store";

// This controller watches for PVCs without a StorageClass and automatically binds them to a default StorageClass if one exists.
// This simulates the Kubernetes behavior of treating PVCs without a storageClassName as if they requested the default StorageClass.
export function useStorageClassController(
    state: AppState,
    dispatch: ActionDispatch<[action: Action]>,
) {
    const { StorageClasses, PersistentVolumeClaims } = state;

    useEffect(() => {
        // Auto-bind PVCs without a StorageClass to the default StorageClass if one exists
        const defaultStorageClass = StorageClasses.find(sc => sc.metadata.annotations["storageclass.kubernetes.io/is-default-class"] === "true");
        if (defaultStorageClass) {
            PersistentVolumeClaims.forEach(pvc => {
                if (!pvc.spec.storageClassName) {
                    dispatch(patchResource("PersistentVolumeClaim", pvc.metadata.name, { spec: { storageClassName: defaultStorageClass.metadata.name } }));
                }
            });
        }
    }, [StorageClasses, PersistentVolumeClaims, dispatch]);

}
