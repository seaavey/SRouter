use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApiError {
    status: u16,
    message: String,
    error_type: String,
    code: Option<String>,
    param: Option<String>,
}

impl ApiError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        let error_type = match status {
            400 | 404 | 409 | 422 => "invalid_request_error",
            401 => "authentication_error",
            403 => "permission_error",
            429 => "rate_limit_error",
            _ => "api_error",
        };

        Self {
            status,
            message: message.into(),
            error_type: error_type.to_owned(),
            code: None,
            param: None,
        }
    }

    pub fn with_error_type(mut self, error_type: impl Into<String>) -> Self {
        self.error_type = error_type.into();
        self
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn with_param(mut self, param: impl Into<String>) -> Self {
        self.param = Some(param.into());
        self
    }

    pub fn status(&self) -> u16 {
        self.status
    }

    pub fn to_envelope(&self) -> ErrorEnvelope {
        ErrorEnvelope {
            error: ErrorBody {
                message: self.message.clone(),
                error_type: self.error_type.clone(),
                code: self.code.clone(),
                param: self.param.clone(),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ErrorEnvelope {
    pub error: ErrorBody,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ErrorBody {
    pub message: String,
    #[serde(rename = "type")]
    pub error_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::ApiError;

    #[test]
    fn status_codes_map_to_the_frozen_standard_error_types() {
        for (status, expected_type) in [
            (400, "invalid_request_error"),
            (404, "invalid_request_error"),
            (409, "invalid_request_error"),
            (422, "invalid_request_error"),
            (401, "authentication_error"),
            (403, "permission_error"),
            (429, "rate_limit_error"),
            (500, "api_error"),
        ] {
            let api_error = ApiError::new(status, "request failed");
            assert_eq!(api_error.status(), status);
            let envelope = serde_json::to_value(api_error.to_envelope()).unwrap();

            assert_eq!(envelope["error"]["type"], expected_type);
        }
    }

    #[test]
    fn api_error_can_override_type_and_attach_code_and_param() {
        let envelope = serde_json::to_value(
            ApiError::new(502, "upstream unavailable")
                .with_error_type("upstream_error")
                .with_code("upstream_unavailable")
                .with_param("provider".to_owned())
                .to_envelope(),
        )
        .unwrap();

        assert_eq!(
            envelope,
            serde_json::json!({
                "error": {
                    "message": "upstream unavailable",
                    "type": "upstream_error",
                    "code": "upstream_unavailable",
                    "param": "provider"
                }
            })
        );
    }

    #[test]
    fn absent_code_and_param_are_omitted_from_the_error_envelope() {
        let envelope =
            serde_json::to_value(ApiError::new(500, "internal failure").to_envelope()).unwrap();

        assert_eq!(
            envelope,
            serde_json::json!({
                "error": {
                    "message": "internal failure",
                    "type": "api_error"
                }
            })
        );
    }
}
