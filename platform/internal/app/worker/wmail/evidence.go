package wmail

import (
	"errors"

	"github.com/pegasusbound/pegasusbound/internal/repository"
)

func evidenceHTTPStatus(err error) int {
	var status *repository.ControlPlaneHTTPError
	if errors.As(err, &status) {
		return status.Status
	}
	return 0
}
